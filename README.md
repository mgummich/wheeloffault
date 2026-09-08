Deutsch → [README.de.md](README.de.md)

# Schuldrad

Self-hosted, installable Schuldrad ("wheel of guilt") for the Scrum ritual
of determining who is at fault this time. Replaces wheelofnames.com with a
deliberately over-professional wheel of responsibility.

**▶ Try the app: <https://mgummich.github.io/wheeloffault/>** ·
[Documentation](https://mgummich.github.io/wheeloffault/docs/)

* **Auditable fairness** – commit/reveal with SHA-256/HMAC, every draw is
  independently recomputable in the browser. The result is fixed *before*
  anything spins.
* **Full history** – event sourcing; guilt reports, hall of shame, appeals,
  immunities, pools ("Gleise", tracks).
* **Seven visualizations** – turntable, train arrival, split-flap display,
  signal, ticket stamp, timetable roll, weight line.
* **PWA** – installable, app shell works offline, respects
  `prefers-reduced-motion`.

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) ·
[docs/en/architecture.md](docs/en/architecture.md) ·
[fairness protocol](docs/en/fairness.md) ·
[event contract](docs/en/events.md) ·
[deployment](docs/en/deployment.md) ·
[contributing](docs/en/contributing.md) ·
[SECURITY.md](SECURITY.md)

## Two operating modes

| Mode | Build | Data | Live sync between browsers |
|---|---|---|---|
| **GitHub Pages** (static) | `pnpm build` | `localStorage`, this browser | – |
| **Server** (Docker/Node) | `pnpm build:server` | SQLite (optionally Postgres) | SSE |

The two modes do not share data with each other.

## Running on GitHub Pages

Schuldrad runs as a static browser app and can be deployed straight to
GitHub Pages. The build output is `dist/web`; the bundled GitHub Actions
workflow `.github/workflows/pages.yml` builds and deploys on every push to
`main`.

Data is stored exclusively in this browser's `localStorage`, under the key
`schuldrad.sessionEvents.v1` (see `src/web/sessionApi.ts`):

* Survives a reload, closing the tab, and restarting the browser: teams,
  participants, draws, and reports stay in this browser.
* Not shared: other browsers, devices, or profiles have their own,
  independent state. Private/incognito windows keep their own state for the
  life of that window and lose it when the window closes.
* There is no server-side database and, as of this writing, no in-app reset.
  The only way to discard the data is to clear this site's browser data
  (site settings → clear storage, or clearing cookies/site data for the
  Pages origin) — closing the tab is not enough.

Try it locally:

```bash
pnpm install
pnpm build
pnpm exec vite preview --host 127.0.0.1
```

## Self-hosted server mode

```bash
docker build -t schuldrad .
docker run -d -p 127.0.0.1:3000:3000 -v schuldrad-data:/data schuldrad
```

Then open http://localhost:3000. In server mode everything lives in
`/data/schuldrad.db`. Schuldrad deliberately ships without authentication.
For access from the network, only run it behind a VPN or a reverse proxy
that provides auth — see [SECURITY.md](SECURITY.md) for the full threat
model.

Without Docker, the frontend must be built explicitly for the server:

```bash
pnpm build:server
pnpm start
```

`build:server` activates the HTTP API and live updates between browsers via
the checked-in `src/web/.env.server` (`VITE_API_MODE=server`). The Docker
build uses the same mode; `pnpm build` remains the static GitHub Pages build
with browser-local data.

### Optionally over-engineered: Postgres + Redis

SQLite remains the default. Anyone who still wants Postgres as the event
store:

```bash
EVENT_STORE=postgres \
DATABASE_URL=postgres://schuldrad:schuldrad@localhost:5432/schuldrad \
pnpm start
```

Redis is optional and serves only as broadcast fanout for SSE when several
server instances are running:

```bash
REDIS_URL=redis://localhost:6379 pnpm start
```

A local all-in-one bundle is available as a Compose profile:

```bash
docker compose --profile overengineered up --build
```

## Development

Requires Node ≥ 26, pnpm.

```bash
pnpm install
pnpm dev          # static browser app on :5173
pnpm dev:full     # optional server mode: server on :3000 + Vite proxy
pnpm verify       # format → lint → typecheck → unit → integration → build
pnpm e2e          # builds and checks server mode and the static PWA under a subpath
```

The optional local server binds to `127.0.0.1` by default. For containers or
deliberately exposed LAN installs, set `HOST=0.0.0.0`.

## Structure

```
src/domain   pure domain: events, state, fairness, projections, views (browser + Node)
src/server   node:http, event store (SQLite/Postgres), command handlers, SSE
src/web      React PWA; api.ts selects between the HTTP backend and the localStorage backend
tests/e2e    Playwright: server journey + static PWA under a subpath
```

Unit and integration tests live as `*.test.ts` next to the modules they
document (e.g. `src/server/api.test.ts` as an API spec,
`src/web/draw.test.ts` for the 409 resumption of a draw).
