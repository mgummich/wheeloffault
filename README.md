# Schuldrad

Selbst gehostetes, installierbares Schuldrad für das Scrum-Ritual
„Wer ist diesmal schuldig?“. Ersetzt wheelofnames.com durch ein absichtlich
über-professionelles Verantwortungsrad: nachvollziehbare Fairness
(Commit/Reveal, im Browser prüfbar), vollständige Historie, Schuldberichte,
Hall of Shame, Einsprüche, Immunitäten.

Architektur: [ARCHITECTURE.md](ARCHITECTURE.md).

## Betrieb

```bash
docker build -t schuldrad .
docker run -d -p 127.0.0.1:3000:3000 -v schuldrad-data:/data schuldrad
```

Danach http://localhost:3000 öffnen. Alles liegt in `/data/schuldrad.db`.
Schuldrad bringt bewusst keine Authentifizierung mit. Für Zugriff aus dem
Netz nur hinter VPN oder Reverse Proxy mit Auth betreiben.

### Optional über-engineered: Postgres + Redis

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
pnpm dev          # Server auf :3000, Vite auf :5173 mit /api-Proxy
pnpm verify       # format → lint → typecheck → unit → integration → build
pnpm e2e          # Playwright gegen den Vite-Build (vorher: pnpm build)
```

Der lokale Server bindet standardmäßig an `127.0.0.1`. Für Container oder
bewusst freigegebene LAN-Installationen `HOST=0.0.0.0` setzen.

## Struktur

```
src/domain   pure Domäne: Events, Zustand, Fairness, Projektionen (Browser + Node)
src/server   node:http, Event-Store (SQLite/Postgres), Command-Handler, SSE
src/web      React-PWA
tests/e2e    Playwright-Journey
```
