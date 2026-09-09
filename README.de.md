English → [README.md](README.md#en) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Schuldrad

Selbst gehostetes, installierbares Schuldrad für das Scrum-Ritual
„Wer ist diesmal schuldig?“. Ersetzt wheelofnames.com durch ein absichtlich
über-professionelles Verantwortungsrad.

**▶ App ausprobieren: <https://mgummich.github.io/wheeloffault/>** ·
[Dokumentation](https://mgummich.github.io/wheeloffault/docs/)

* **Nachvollziehbare Fairness** – Commit/Reveal mit SHA-256/HMAC, jede Ziehung
  ist im Browser unabhängig nachrechenbar. Das Ergebnis steht fest, *bevor*
  sich etwas dreht.
* **Vollständige Historie** – Event Sourcing; Schuldberichte, Hall of Shame,
  Einsprüche, Immunitäten, Pools („Gleise“).
* **Sieben Visualisierungen** – Drehscheibe, Zugeinfahrt, Fallblattanzeige,
  Signal, Fahrkartenstempel, Fahrplan-Rolle, Gewichtslinie.
* **PWA** – installierbar, App-Shell offline, `prefers-reduced-motion` respektiert.

Architektur: [ARCHITECTURE.md](ARCHITECTURE.md#en) (Englisch, kanonisch) ·
[docs/de/architektur.md](docs/de/architektur.md) ·
[Fairness-Protokoll](docs/de/fairness.md) ·
[Event-Vertrag](docs/de/events.md) ·
[Betrieb](docs/de/deployment.md) ·
[Mitwirken](docs/de/contributing.md) ·
[SECURITY.md](SECURITY.md) (Englisch)

## Zwei Betriebsmodi

| Modus | Build | Daten | Live-Sync zwischen Browsern |
|---|---|---|---|
| **GitHub Pages** (statisch) | `pnpm build` | `localStorage`, dieser Browser | – |
| **Server** (Docker/Node) | `pnpm build:server` | SQLite (optional Postgres) | SSE |

Beide Modi teilen ihre Daten nicht miteinander.

## Betrieb auf GitHub Pages

Schuldrad läuft als statische Browser-App und kann direkt über GitHub Pages
bereitgestellt werden. Der Build liegt in `dist/web`; die mitgelieferte
GitHub-Actions-Workflowdatei `.github/workflows/pages.yml` baut ihn und
veröffentlicht ihn bei jedem Push auf `main`.

Die Daten werden ausschließlich im `localStorage` dieses Browsers gespeichert,
unter dem Schlüssel `schuldrad.sessionEvents.v1` (siehe
`src/web/sessionApi.ts`):

* Überlebt Reload, Tab schließen und Browser neu starten: Teams,
  Teilnehmer, Ziehungen und Berichte bleiben in diesem Browser erhalten.
* Nicht geteilt: andere Browser, Geräte oder Profile haben ihren eigenen,
  unabhängigen Zustand. Private-/Inkognito-Fenster behalten ihren Zustand nur
  für die Lebensdauer dieses Fensters und verlieren ihn, sobald es
  geschlossen wird.
* Es gibt keine Server-Datenbank und derzeit keinen Reset-Knopf in der App.
  Die Daten werden nur gelöscht, wenn die Website-Daten für diese Website im
  Browser gelöscht werden (Website-Einstellungen → Speicher löschen, bzw.
  Cookies/Website-Daten löschen) — das bloße Schließen des Tabs genügt
  nicht.

Lokal testen:

```bash
pnpm install
pnpm build
pnpm exec vite preview --host 127.0.0.1
```

## Selbst gehosteter Serverbetrieb

```bash
docker build -t schuldrad .
docker run -d -p 127.0.0.1:3000:3000 -v schuldrad-data:/data schuldrad
```

Danach http://localhost:3000 öffnen. Im Serverbetrieb liegt alles in
`/data/schuldrad.db`. Standardmäßig gibt es keine Authentifizierung; im
Serverbetrieb kann optional ein einzelnes gemeinsames Betriebspasswort über
`SCHULDRAD_PASSWORD` die `/api/*`-Routen absichern (außer `/api/health` und
`/api/auth/*`) (siehe
[docs/de/deployment.md](docs/de/deployment.md) § 3a). Für Zugriff aus dem
Netz nur hinter VPN oder Reverse Proxy mit Auth betreiben — das
vollständige Bedrohungsmodell steht in [SECURITY.md](SECURITY.md).

Ohne Docker muss das Frontend ausdrücklich für den Server gebaut werden:

```bash
pnpm build:server
pnpm start
```

`build:server` aktiviert über das eingecheckte `src/web/.env.server`
(`VITE_API_MODE=server`) die HTTP-API und Live-Updates zwischen Browsern.
Der Docker-Build nutzt denselben Modus; `pnpm build` bleibt der statische
GitHub-Pages-Build mit browser-lokalen Daten.

### Optional over-engineered: Postgres + Redis

SQLite bleibt der Standard. Wer trotzdem Postgres als Event-Store will:

```bash
EVENT_STORE=postgres \
DATABASE_URL=postgres://schuldrad:schuldrad@localhost:5432/schuldrad \
pnpm start
```

Redis ist optional und dient nur als Broadcast-Fanout für SSE, wenn mehrere
Serverinstanzen laufen:

```bash
REDIS_URL=redis://localhost:6379 pnpm start
```

Ein lokales Komplettpaket gibt es per Compose-Profil:

```bash
docker compose --profile overengineered up --build
```

## Entwicklung

Voraussetzung: Node ≥ 26, pnpm.

```bash
pnpm install
pnpm dev          # Statische Browser-App auf :5173
pnpm dev:full     # Optionaler Serverbetrieb: Server auf :3000 + Vite-Proxy
pnpm verify       # format → lint → typecheck → unit → integration → build
pnpm e2e          # Baut und prüft Serverbetrieb und statische PWA im Unterpfad
```

Der optionale lokale Server bindet standardmäßig an `127.0.0.1`. Für Container
oder bewusst freigegebene LAN-Installationen `HOST=0.0.0.0` setzen.

## Struktur

```
src/domain   pure Domäne: Events, Zustand, Fairness, Projektionen, Views (Browser + Node)
src/server   node:http, Event-Store (SQLite/Postgres), Command-Handler, SSE
src/web      React-PWA; api.ts wählt zwischen HTTP-Backend und localStorage-Backend
tests/e2e    Playwright: Server-Journey + statische PWA im Unterpfad
```

Unit-/Integrationstests liegen als `*.test.ts` neben ihren Modulen und
dokumentieren das Verhalten (z. B. `src/server/api.test.ts` als API-Spec,
`src/web/draw.test.ts` für die 409-Wiederaufnahme einer Ziehung).
