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
| `src/domain`  | Browser + Node  | nur `src/domain`     | Events, Zustandsaufbau, Fairness, Projektionen. Pure Funktionen, keine I/O. |
| `src/server`  | Node            | `src/domain`         | HTTP-Server, Event-Store (SQLite), Command-Handler, SSE. |
| `src/web`     | Browser         | `src/domain`         | React-Oberfläche, Animation, Service Worker, Verifier-UI. |

Die Domäne kennt weder HTTP noch SQLite noch React. Der Fairness-Verifier im
Browser ist buchstäblich dieselbe Funktion wie auf dem Server.

## 2. Domänenmodell

```
Team          Container für alles. Ein Event-Stream pro Team.
Member        Person im Team. Wird nie gelöscht, nur deaktiviert.
Pool          Benannte Teilmenge der Members (z. B. „Backend“, „Daily“).
Spin          Eine Ziehung: Commit (Server bindet Seed + Gewichte) → Reveal (Ergebnis).
FairnessPolicy Aktive Gewichtsmodifikatoren samt Parametern. Sichtbar im UI.
WeightModifier Pure Funktion  (weights, context) → weights.
Appeal        Einspruch gegen eine Schuld; Ergebnis „stattgegeben“ oder „abgelehnt“.
Immunity      Einmaliger Schutz: Gewicht 0 bei der nächsten Ziehung, wird dabei verbraucht.
```

### Events (persistierter Vertrag, `src/domain/events.ts`)

```
TeamCreated              { teamId, name }
MemberJoined             { memberId, name }
MemberDeactivated        { memberId }
MemberReactivated        { memberId }
PoolCreated              { poolId, name }
PoolMembershipChanged    { poolId, memberIds }
FairnessPolicyChanged    { policy }
SpinCommitted            { spinId, poolId, nonce, commitment, participants:[{memberId, weight}], modifiers:[...], serverSeed }
SpinRevealed             { spinId, serverSeed, clientSeed, digest, selectedMemberId }
GuiltAppealed            { spinId, reason }
AppealUpheld             { spinId }
AppealRejected           { spinId }
ImmunityGranted          { memberId, reason }
ImmunityConsumed         { memberId, spinId }
```

Jedes Event hat zusätzlich `type`, `at` (ISO-Zeit) und – in der Datenbank –
`streamId`, `version` (1-basiert, lückenlos pro Stream) und `position`
(global). Events sind unveränderlich. Ein Event-Typ wird nie umgedeutet;
neue Bedeutung = neuer Typ. Felder dürfen optional hinzukommen, nie
entfernt oder umbenannt werden (`upcast` in `events.ts` ist die einzige
erlaubte Stelle für Altdaten-Kompatibilität, aktuell leer).

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
* Entscheidungsfunktionen (`addMember`, `commitSpin`, `revealSpin`, …) sind
  pure Funktionen `(state, input) → Event[]` und werfen `DomainError` bei
  ungültigen Übergängen.
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
2. calculateWeights(participants, policy, state)   Modifikatoren in fester Reihenfolge
3. Server: serverSeed = 32 Zufallsbytes (crypto.getRandomValues)
   commitment = SHA-256( canonicalJson({ serverSeed, nonce, participants }) )
   → SpinCommitted { commitment, nonce, participants (mit Gewichten), serverSeed }
   Der serverSeed liegt im Event (sonst überlebt ein offener Spin keinen Neustart),
   wird aber vor dem Reveal nie über HTTP ausgeliefert (`views.ts`). Wer die
   Datenbank lesen kann, kann das Ergebnis vorhersagen – die Datenbank ist Vertrauensbasis.
4. Client liefert clientSeed (beliebiger String, Standard: 16 Zufallsbytes hex)
5. digest = HMAC-SHA-256(key = serverSeed, msg = `${commitment}:${clientSeed}:${nonce}`)
   r = uint64(digest[0..8]) mod Σweights
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

Modifikatoren (`src/domain/fairness/modifiers.ts`), alle `weights + context → weights`:

```
uniform     Ausgangsgewicht 1000 für alle
pity        +X % pro Ziehung ohne Treffer seit der letzten Schuld
cooldown    Gewicht 0 für N Ziehungen nach einer Schuld (würde er alle ausschließen,
            wird er für diese Ziehung übersprungen und mit Faktor 1,000 protokolliert)
exhaustion  −X % pro Schuld in den letzten N Ziehungen
newcomer    ×Faktor für Mitglieder mit weniger als N Teilnahmen
manual      expliziter Faktor pro Mitglied
immunity    Gewicht 0, wenn eine Immunität vorliegt (wird durch den Spin verbraucht)
```

Gamification ändert nie Gewichte. Jede Gewichtsänderung ist über die aktive
`FairnessPolicy` sichtbar und im `SpinCommitted`-Event pro Teilnehmer
dokumentiert.

## 5. Projektionen (Read Models)

Alle Read Models sind pure Funktionen über `TeamState` in `src/domain/projections/`:

```
memberReport(state, memberId)   Schuldbericht: Treffer, Schuldquote, Erwartungswert, Schuldindex,
                                Zeit seit letzter Schuld, Streaks, Fairness-Abweichung, Achievements,
                                Schuldpunkte, Entschädigungsminuten
teamStatistics(state)           Hall of Shame, Rangliste, Verteilung, Fairness-Übersicht
spinHistory(state)              chronologische Liste inkl. Einsprüche
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
POST /api/teams/:id/members/:mid/immunity   { reason }
PUT  /api/teams/:id/policy      FairnessPolicy
POST /api/teams/:id/pools       { name, memberIds }
PUT  /api/teams/:id/pools/:pid  { memberIds }
POST /api/teams/:id/spins       { spinId, poolId? }        → SpinCommitted-Daten   (409 bei offenem Spin)
POST /api/teams/:id/spins/:sid/reveal { clientSeed }       → SpinRevealed-Daten
POST /api/teams/:id/spins/:sid/appeal { reason }
POST /api/teams/:id/spins/:sid/appeal/uphold
POST /api/teams/:id/spins/:sid/appeal/reject
GET  /api/teams/:id/members/:mid/report      Schuldbericht
GET  /api/teams/:id/events                   SSE: ein `event: appended` pro neuem Event
GET  /api/health
```

Fehler: `{ error: string }` mit 400 (ungültige Eingabe), 404, 409 (Konflikt).
Alle Eingaben werden explizit validiert (`src/server/validate.ts`; die
FairnessPolicy in `src/domain/fairness/policy.ts`, weil der Browser dieselbe Prüfung nutzt).

Es gibt keine Authentifizierung. Schuldrad ist für ein vertrauenswürdiges
Netz (Team-LAN, VPN) gedacht; wer es öffentlich betreibt, setzt einen
Reverse Proxy mit Auth davor.

Der Client hält keinen eigenen Domänenzustand. Nach jedem Command und jeder
SSE-Nachricht lädt er `GET /api/teams/:id` neu.

## 7. Persistenz

SQLite über `node:sqlite` (im Node-Standard, keine Abhängigkeit). Eine Datei,
eine Tabelle, die zählt:

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
```

Migrationen: nummerierte Einträge in `src/server/migrations.ts`, je in einer
Transaktion angewendet, in `schema_migrations` protokolliert. Angewendete
Migrationen werden nie editiert.

## 8. Realtime

Server-Sent Events. Der Server hält pro Team eine Menge offener Antworten
und schreibt nach jedem erfolgreichen Append `event: appended`. Der Client
lädt daraufhin den Team-Zustand neu. Kein WebSocket, keine Nachrichtenwarteschlange.

## 9. Frontend

React 19 + Vite. Kein Router-Paket: der Hash (`#/team/:id/spin`) ist die
Route. Kein State-Management-Paket: `TeamView` vom Server + ein paar
`useState`. Animationen (`src/web/wheel/`) erhalten das persistierte
Ergebnis als Prop und dürfen keinen Domänenzustand besitzen. Sie sind
überspringbar und respektieren `prefers-reduced-motion`.

PWA: `manifest.webmanifest` + handgeschriebener Service Worker
(App-Shell-Cache; `/api` wird nie angefasst, Historie kommt immer vom Server).

`src/web` importiert aus `src/server/views.ts` ausschließlich Typen
(`TeamView`, `SpinView`) – das ist der HTTP-Vertrag, kein Serverstaat.

## 10. Deployment

Ein Container (`Dockerfile`, Multi-Stage): Vite-Build → statische Dateien;
der Server läuft als unveränderte TypeScript-Quelle direkt unter Node ≥ 26
(natives Type-Stripping, kein Bundler). Volume für `data/schuldrad.db`. `PORT` und
`DATA_DIR` per Umgebungsvariable. Kein Reverse Proxy nötig.

## 11. Verifikationsschleife

`pnpm verify` = format → lint → typecheck → unit/property → integration →
build. E2E (`pnpm e2e`) mit Playwright gegen den gebauten Server. CI
(`.github/workflows/ci.yml`) führt zusätzlich Container-Build, `pnpm audit`,
Trivy-Scan und SBOM aus.
