English → [ARCHITECTURE.md](../../ARCHITECTURE.md#en) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen englischen
> Fassung hinterherhinken. Bei Widerspruch gilt `ARCHITECTURE.md` im
> Repository-Root.

# Schuldrad — Architektur

Schuldrad ist ein selbst gehostetes, installierbares PWA-Werkzeug für das
Scrum-Ritual „Wer ist diesmal schuldig?“. Es ersetzt wheelofnames.com durch ein
absichtlich über-professionelles Verantwortungsrad mit nachvollziehbarer
Fairness, vollständiger Historie und Schuldberichten.

Leitsatz: **Das System darf over-engineered sein, der Code nicht.**

## 1. Überblick

```
Browser (PWA, React)                       Server (Node 26, kein Framework)
┌──────────────────────────┐   HTTP/JSON   ┌────────────────────────────────┐
│ Ansichten                │ ────────────▶ │ Command-Handler                 │
│ Rad-Animation            │               │   lädt Stream → Domänenfunktion│
│ Schuldbericht/Statistik  │ ◀──────────── │   → Events → Event-Store       │
│ Verifier (Web Crypto)    │   SSE         │ Projektionen (pure Funktionen) │
└──────────────────────────┘               │ SQLite (node:sqlite, 1 Datei)  │
              ▲                            └────────────────────────────────┘
              └── gleiches Domänenmodul (src/domain) auf beiden Seiten
```

Ein einziges npm-Paket, drei Quellordner:

| Ordner        | Läuft in        | Darf importieren aus | Inhalt |
|---------------|-----------------|----------------------|--------|
| `src/domain`  | Browser + Node  | nur `src/domain`     | Events, Zustandsaufbau, Fairness, Projektionen, öffentliche HTTP-Ansichten (`views.ts`). Pure Funktionen, keine I/O. |
| `src/server`  | Node            | `src/domain`         | HTTP-Server, Event-Store (SQLite oder Postgres, § 7), Command-Handler, SSE. |
| `src/web`     | Browser         | `src/domain`         | React-Oberfläche, Animation, Service Worker, Verifier-UI. |

`src/web` nutzt `src/domain/views.ts` (`TeamView`, `SpinView`, `teamView`,
`spinView`) sowohl für die HTTP-Antwortformen als auch für den Session-Modus
— keine Ausnahme mehr nötig, die Datei liegt in der Domäne.

Die Domäne kennt weder HTTP noch SQLite noch React. Der Fairness-Verifier im
Browser (`verifySpin()`) und der Reveal-Pfad des Servers laufen beide über
dieselben gemeinsamen Commit-/Digest-/Auswahl-Primitiven in
`src/domain/fairness` — der Server leitet selbst neu ab, statt
`verifySpin()` aufzurufen, aber es gibt keine separate, potenziell
abweichende Client-Implementierung.

## 2. Domänenmodell

```
Team          Container für alles. Ein Event-Stream pro Team.
Member        Person im Team. Wird nie gelöscht, nur deaktiviert.
Pool          Benannte Teilmenge der Members (z. B. „Backend“, „Daily“). Umbenennbar,
              löschbar; die Ziehungshistorie eines gelöschten Pools bleibt erhalten.
Spin          Eine Ziehung: Commit (Server bindet Seed + Gewichte) → Reveal (Ergebnis).
FairnessPolicy Aktive Gewichtsmodifikatoren samt Parametern. Sichtbar im UI.
WeightModifier Pure Funktion  (weights, context) → weights.
Appeal        Einspruch gegen eine Schuld; Ergebnis „stattgegeben“ oder „abgelehnt“.
Immunity      Einmaliger Schutz: Gewicht 0 bei der nächsten Ziehung, wird dabei verbraucht.
              Kann vor dem Verbrauch widerrufen werden.
```

### Events (persistierter Vertrag, `src/domain/events.ts`)

```
TeamCreated              { teamId, name }
MemberJoined             { memberId, name }
MemberDeactivated        { memberId }
MemberReactivated        { memberId }
PoolCreated              { poolId, name }
PoolMembershipChanged    { poolId, memberIds }
PoolRenamed              { poolId, name }
PoolDeleted              { poolId }
FairnessPolicyChanged    { policy }
SpinCommitted            { spinId, poolId, nonce, commitment, participants:[{memberId, weight}], modifiers:[...], serverSeed }
SpinRevealed             { spinId, serverSeed, clientSeed, digest, selectedMemberId }
GuiltAppealed            { spinId, reason }
AppealUpheld             { spinId }
AppealRejected           { spinId }
ImmunityGranted          { memberId, reason }
ImmunityConsumed         { memberId, spinId }
ImmunityRevoked          { memberId }
```

Jedes Event hat zusätzlich `type`, `at` (ISO-Zeit) und – in der Datenbank –
`streamId`, `version` (1-basiert, lückenlos pro Stream) und `position`
(global). Events sind unveränderlich. Ein Event-Typ wird nie umgedeutet;
neue Bedeutung = neuer Typ. Felder dürfen optional hinzukommen, nie
entfernt oder umbenannt werden (`upcast` in `events.ts` ist die einzige
erlaubte Stelle für Altdaten-Kompatibilität, aktuell die Identitätsfunktion).

## 3. Befehlsfluss

```
Command  ──▶  decide(state, command)  ──▶  Event[]  ──▶  append(streamId, expectedVersion, events)
                     ▲                                          │
              state = replay(events)                            ▼
                                                         Projektionen aus replay()
```

* `replay(events): TeamState` in `src/domain/team.ts` faltet den Stream zu
  einem Zustand. Kein Snapshotting: ein Team hat einige tausend Events, das
  ist in SQLite in Millisekunden gelesen.
* Entscheidungsfunktionen (`addMembers`, `commitSpin`, `revealSpin`, …)
  nehmen `(state, input)` entgegen und werfen `DomainError` bei ungültigen
  Übergängen. Die meisten geben synchron `Event[]` zurück; `commitSpin`
  und `revealSpin` (`src/domain/fairness/spin.ts`) sind async und geben
  `Promise<CommitResult>` (`{ events, spinId }`) bzw.
  `Promise<DomainEvent[]>` zurück.
* Der Server macht pro Command: Stream laden → entscheiden → mit
  `expectedVersion = state.version` anhängen. Konflikt (jemand war schneller)
  → Stream neu laden, Command erneut entscheiden, maximal 3 Versuche.

### Nebenläufigkeit & Idempotenz

* `events(stream_id, version)` ist `UNIQUE`. Zwei konkurrierende Writer können
  nie beide Version n+1 schreiben.
* Spin-IDs kommen vom Client (UUID). `commitSpin` mit einer bereits
  existierenden Spin-ID ist ein No-Op, das den bestehenden Spin zurückgibt.
  Ein Retry erzeugt also nie zwei offizielle Ziehungen.
* Pro Team ist höchstens ein Spin „committed, aber nicht revealed“. Ein
  weiterer Commit wird mit `409` und der offenen Spin-ID abgelehnt; der
  Client setzt den offenen Spin fort.
* `revealSpin` mit identischem `clientSeed` ist idempotent; abweichender
  `clientSeed` nach erfolgtem Reveal → `409`.
* Absturz zwischen Commit und Reveal: Der Commit ist persistiert, das Team
  sieht nach Reload „Ziehung läuft“ und kann sie abschließen. Kein
  Gewinner ohne persistiertes `SpinRevealed`. Ein zweiter Browser, der den
  offenen Spin mit eigenem `clientSeed` abschließen will, bekommt `409` und
  übernimmt das bereits persistierte Ergebnis.
* Ein aufgehobener Spin (Einspruch stattgegeben) zählt statistisch als nicht
  geschehen: weder Treffer noch Erwartungswert.

## 4. Fairness-Protokoll (Commit/Reveal)

```
1. eligibleMembers(state, poolId)                 aktive Mitglieder ∩ Pool
2. calculateWeights(state, members)                Modifikatoren in fester Reihenfolge
3. Server: serverSeed = 32 Zufallsbytes (crypto.getRandomValues)
   commitment = SHA-256( canonicalJson({ serverSeed, nonce, participants }) )
   → SpinCommitted { commitment, nonce, participants (mit Gewichten), serverSeed }
   Der serverSeed liegt im Event (sonst überlebt ein offener Spin keinen Neustart),
   wird aber vor dem Reveal nie über HTTP ausgeliefert (`domain/views.ts`). Wer die
   Datenbank lesen kann, kann das Ergebnis vorhersagen – die Datenbank ist Vertrauensbasis.
4. Client liefert clientSeed (beliebiger String, Standard: 16 Zufallsbytes hex)
5. digest = HMAC-SHA-256(key = serverSeed, msg = `${commitment}:${clientSeed}:${nonce}`)
   r = uint64(digest[0..16]) mod Σweights
   selected = erster Teilnehmer, dessen kumulatives Gewicht > r
   → SpinRevealed { serverSeed, clientSeed, digest, selectedMemberId }
6. Animation fährt zum persistierten Ergebnis.
```

Gewichte sind ganze Zahlen (Basis 1000 = „1,000×“), damit die Ziehung
plattformunabhängig exakt ist. Teilnehmer sind nach `memberId` sortiert
(stabile Reihenfolge, Teil des Commitments).

Invarianten (durch deterministische und Property-Tests abgesichert):

```
gleiche Eingaben        = gleiches Ergebnis
inaktives Mitglied      = kann nicht gezogen werden
Gewicht 0               = kann nicht gezogen werden
Gewichte endlich, ≥ 0
alle Gewichte 0         = Fehler, kein Spin
Teilnehmerreihenfolge   stabil
Modifikatorreihenfolge  deterministisch (feste Liste in modifiers.ts)
Commitment bindet Seed + Gewichte
Reveal reproduziert Commitment
Browser-Verifier reproduziert Server
```

Jeder Teilnehmer startet mit Gewicht 1000 (`FACTOR_ONE` in
`src/domain/fairness/modifiers.ts`). Dann
wenden die aktivierten Modifikatoren (`src/domain/fairness/modifiers.ts`,
alle `weights + context → weights`) in dieser festen Reihenfolge an:

```
pity        +X % pro Ziehung ohne Treffer seit der letzten Schuld
cooldown    Gewicht 0 für N Ziehungen nach einer Schuld
exhaustion  −X % pro Schuld in den letzten N Ziehungen
newcomer    ×Faktor für Mitglieder mit weniger als N Teilnahmen
manual      expliziter Faktor pro Mitglied
immunity    Gewicht 0, wenn eine Immunität vorliegt (wird durch den Spin verbraucht)
```

Ist das Gewicht jedes Teilnehmers nach allen Modifikatoren 0 — aus
beliebigem Grund (cooldown, immunity, ein manueller Faktor 0 oder
exhaustion, das dorthin führt), nicht nur cooldown — und ist cooldown
aktiviert, läuft die gesamte Berechnung einmal erneut mit neutralisiertem
cooldown und wird mit Faktor 1,000 für jedes Mitglied protokolliert; die
Ziehung schlägt nur fehl, wenn danach immer noch alle Gewichte 0 sind.

Gamification ändert nie Gewichte. Jede Gewichtsänderung ist über die aktive
`FairnessPolicy` sichtbar und im `SpinCommitted`-Event pro Teilnehmer
dokumentiert.

## 5. Projektionen (Read Models)

Alle Read Models sind pure Funktionen über `TeamState` in `src/domain/projections/`:

```
memberReport(state, memberId)   Schuldbericht: Treffer, Schuldquote, Erwartungswert, Schuldindex,
                                Zeit seit letzter Schuld, Streaks, Fairness-Abweichung, Achievements,
                                Schuldpunkte, Entschädigungsminuten
teamStatistics(state)           Hall of Shame (Rangliste), maximale Fairness-Abweichung,
                                Ziehungszähler und Ziehungshistorie (`.history`, neuste zuerst
                                inkl. Einsprüche — gebaut vom modulprivaten spinHistory-Helfer,
                                kein eigener Export)
```

Nichts davon wird gespeichert. Die Event-Historie ist die einzige Wahrheit;
„Projektion neu aufbauen“ heißt: Seite neu laden.

## 6. HTTP-Vertrag

```
GET  /api/teams                              [{ teamId, name, memberCount, spinCount }]
POST /api/teams                 { name }     → 201 TeamView
GET  /api/teams/:id                          TeamView (state + statistics)
POST /api/teams/:id/members     { name }  |  { names: [...] }   Liste einfügen
POST /api/teams/:id/members/:mid/deactivate
POST /api/teams/:id/members/:mid/reactivate
POST   /api/teams/:id/members/:mid/immunity   { reason }
DELETE /api/teams/:id/members/:mid/immunity   widerruft die älteste Immunität
PUT    /api/teams/:id/policy      FairnessPolicy
POST   /api/teams/:id/pools       { name, memberIds }
PUT    /api/teams/:id/pools/:pid  { memberIds }
POST   /api/teams/:id/pools/:pid/rename  { name }
DELETE /api/teams/:id/pools/:pid
POST /api/teams/:id/spins       { spinId, poolId? }        → SpinCommitted-Daten   (409 bei offenem Spin)
POST /api/teams/:id/spins/:sid/reveal { clientSeed }       → SpinRevealed-Daten
POST /api/teams/:id/spins/:sid/appeal { reason }
POST /api/teams/:id/spins/:sid/appeal/uphold
POST /api/teams/:id/spins/:sid/appeal/reject
GET  /api/teams/:id/members/:mid/report      Schuldbericht
GET  /api/teams/:id/events                   SSE: ein `event: appended` pro neuem Event
GET  /api/health
POST /api/auth/login             { password } → setzt Session-Cookie (nur wenn Auth aktiv ist)
POST /api/auth/logout            löscht das Session-Cookie
GET  /api/auth/status                        { enabled, authenticated }
```

Fehler: `{ error: string, code: string }` mit 400 (ungültige Eingabe), 401
(Auth), 403 (CSRF-/Host-Prüfungen: `host_not_allowed`, `origin_mismatch`),
404, 409 (Konflikt), 415 (nicht unterstützter Content-Type), 429
(Rate-Limit), 500/503 (interner Fehler / Überlastung). `code` ist ein
stabiler, maschinenlesbarer Bezeichner, den der Client lokalisiert
(`src/web/apiError.ts`, `src/web/i18n/`); die menschenlesbare `error`-Meldung
ist Englisch und nur ein Fallback für unbekannte Codes. Alle Eingaben werden
serverseitig
explizit validiert (`src/server/validate.ts`; die FairnessPolicy über
`assertPolicy` in `src/domain/fairness/policy.ts`, das nur von
`src/server/http.ts` importiert wird). Der Browser importiert aus diesem
Modul nur den Typ `FairnessPolicy`, nicht die Prüfung; die `min`/`max`-Werte
der Zahlenfelder im Fairness-Formular sind UI-Hinweise, keine
Validierungsgrenze — sie schränken einen programmatischen Schreibzugriff
nicht ein.

Es gibt standardmäßig keine Authentifizierung: Schuldrad ist für ein
vertrauenswürdiges Netz (Team-LAN, VPN) gedacht; wer es öffentlich
betreibt, setzt einen Reverse Proxy mit Auth davor. Der Server-Modus kann
optional ein einzelnes gemeinsames Deployment-Passwort verlangen
(`SCHULDRAD_PASSWORD`/`SCHULDRAD_PASSWORD_FILE`), das jede `/api/*`-Route
außer `/api/health` und `/api/auth/*` hinter einem serverseitigen
Session-Cookie absichert (`src/server/auth.ts`). Das ist ein Türschloss,
keine Mehrbenutzer-Authentifizierung — das vollständige Bedrohungsmodell,
was geschützt wird und was nicht, steht in [SECURITY.md](../../SECURITY.md)
(Englisch).

Der Client hält keinen eigenen Domänenzustand. Die meisten Mutationen
liefern den frischen `TeamView` zurück, den der Client direkt übernimmt; die
beiden Spin-Routen (`POST /api/teams/:id/spins` und `.../reveal`, siehe
Routentabelle oben) liefern stattdessen nur den schmaleren `SpinView`. In
jedem Fall lädt der Client zusätzlich bei jeder SSE-Nachricht
`GET /api/teams/:id` neu (das Echo des eigenen Appends ist ein harmloser
Doppel-Fetch).

## 7. Persistenz

SQLite über `node:sqlite` ist der Standard: eine Datei, eine Tabelle, die zählt:

```sql
CREATE TABLE events (
  position    INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id   TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  type        TEXT    NOT NULL,
  payload     TEXT    NOT NULL,   -- JSON
  at          TEXT    NOT NULL,
  UNIQUE (stream_id, version)
);
CREATE INDEX events_type ON events (type);
```

Migrationen: nummerierte Einträge in `src/server/migrations.ts`, jeder mit
einem `sql`-Feld (SQLite) und einem separat ausgeschriebenen `pgSql`-Feld
(Postgres) statt einer Ableitung voneinander, je in einer Transaktion
angewendet, in `schema_migrations` protokolliert. Angewendete Migrationen
werden nie editiert.

Optional kann der gleiche Event-Store-Vertrag mit Postgres betrieben werden:

```bash
EVENT_STORE=postgres DATABASE_URL=postgres://... pnpm start
```

Die Domäne und Projektionen bleiben unverändert. Postgres speichert dieselben
Events in derselben logischen Tabelle; `payload` ist dort `JSONB`, `position`
ist `BIGSERIAL`. Nebenläufigkeit bleibt optimistisch über die lückenlose
Stream-Version und `UNIQUE (stream_id, version)`. SQLite bleibt bewusst der
Pfad ohne Infrastruktur.

## 8. Realtime

Server-Sent Events. Der Server hält pro Team eine Menge offener Antworten
und schreibt nach jedem erfolgreichen Append `event: appended`. Der Client
lädt daraufhin den Team-Zustand neu. Kein WebSocket.

Optional kann Redis als reines Broadcast-Fanout aktiviert werden:

```bash
REDIS_URL=redis://localhost:6379 pnpm start
```

Redis ist kein Cache und keine zweite Wahrheit. Ein Server publiziert nach
persistierten Appends die Event-Metadaten, andere Instanzen liefern sie an
ihre lokalen SSE-Clients aus.

## 9. Frontend

React 19 + Vite. Kein Router-Paket: der Hash (`#/team/:id/:page/:arg`,
`src/web/route.ts`) ist die Route und löst sieben Seiten auf — Home sowie,
je Team, Spin (Standard), Teilnehmer, Statistik, Fairness,
Bericht/:memberId und Ziehung/:spinId. Kein State-Management-Paket: `TeamView` vom
Server + ein paar `useState`. Animationen (`src/web/wheel/`) erhalten das
persistierte Ergebnis als Prop und dürfen keinen Domänenzustand besitzen.
Sie sind überspringbar und respektieren `prefers-reduced-motion`.

Wegweiser durch `src/web`:

```
api.ts           Fassade: wählt per VITE_API_MODE zwischen zwei Backends
serverApi.ts     HTTP-Client; exportiert den gemeinsamen Vertrag `type Api`
sessionApi.ts    In-Browser-Event-Store (localStorage) mit derselben Api
apiError.ts      ApiError beider Backends + errorMessage() (via Code lokalisiert, § 6)
draw.ts          performDraw(): Commit → Reveal inkl. 409-Wiederaufnahme
useTeam.ts       Team laden, SSE-Refresh
route.ts         Hash-Router; views/ die Seiten; wheel/ die Visualisierungen
AnimPanel.tsx    Animationseinstellungen (localStorage via animSettings.ts)
share.ts         Ergebniskarte pro Ziehung (Canvas-PNG) + ShareDialog.tsx (natives <dialog>)
```

PWA: `manifest.webmanifest` + handgeschriebener Service Worker
(App-Shell-Cache nach Network-First plus Cache-First-Laufzeit-Caching von
`assets/`; `/api` wird nie angefasst, Historie kommt immer vom Server).

`src/web` importiert aus `src/domain/views.ts` Typen (`TeamView`, `SpinView`)
und die puren View-Funktionen – das ist der HTTP-Vertrag, kein Serverstaat
(siehe Tabelle in Abschnitt 1).

## 10. Deployment

Ein Container (`Dockerfile`, Multi-Stage): Vite-Build → statische Dateien;
der Server läuft als unveränderte TypeScript-Quelle direkt unter Node ≥ 26
(natives Type-Stripping, kein Bundler). Volume für `/data`. `PORT`, `HOST`,
`DATA_DIR` und `WEB_DIR` per Umgebungsvariable (`src/server/main.ts`) —
`HOST` ist tragend: Das Dockerfile setzt es auf `0.0.0.0`, da der Server
sonst nur auf `127.0.0.1` bindet. Kein Reverse Proxy nötig.

## 11. Verifikationsschleife

`pnpm verify` = format → lint → typecheck → unit/property → integration →
build. E2E (`pnpm e2e`) mit Playwright gegen den gebauten Server. CI
(`.github/workflows/ci.yml`) führt zusätzlich Container-Build, `pnpm audit`,
Trivy-Scan, SBOM und einen `status`-Job aus.

`docs/STATUS.json` ist eine generierte Momentaufnahme vom letzten Mal, als
alle acht oben genannten Prüfungen (die sechs aus `pnpm verify`, plus
`build:server` und `e2e`) grün liefen, mit Bestanden/Fehlgeschlagen und
einer Ergebniszeile je Prüfung. `pnpm status` (`scripts/status.mjs`)
erzeugt sie neu aus der tatsächlichen Ausgabe der Befehle, und der CI-Job
`status` führt dieses Skript aus und danach `git diff --exit-code
docs/STATUS.json` — ein veralteter Bericht lässt den Build scheitern, sie
ist also ein Gate, kein handgepflegter Höflichkeitsvermerk.
