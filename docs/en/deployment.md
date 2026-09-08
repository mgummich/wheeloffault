Deutsch → [deployment.md](../de/deployment.md)

# Deployment Regulation

*Schuldrad Operations Bureau — Directorate of Infrastructure*

## § 1 Two modes, not shared

| Mode | Build | Data | Live sync | Fairness trust boundary |
|---|---|---|---|---|
| Static (GitHub Pages) | `pnpm build` | browser `localStorage` | none | see [fairness.md](fairness.md) § 6a — self-auditing only |
| Server (Docker/Node) | `pnpm build:server` | SQLite or Postgres | SSE | seed lives server-side, unreachable from participants |

The modes are independent products built from the same source; a team's
static-mode data and its server-mode data are entirely separate and never
migrate into each other automatically.

## § 2 Static mode

`pnpm build` produces `dist/web`, a self-contained static site. It is
deployed by `.github/workflows/pages.yml` on every push to `main`. There is
no backend: `src/web/sessionApi.ts` runs the same command/decide/replay
domain logic as the server, against `localStorage` instead of SQLite. See
[README.md](../../README.md) for the exact persistence semantics
(survives reload/tab-close/restart, cleared only via the browser's site
data controls) and [SECURITY.md](../../SECURITY.md) for what this mode
does and does not protect against.

## § 3 Server mode

### Docker (recommended)

```bash
docker build -t schuldrad .
docker run -d -p 127.0.0.1:3000:3000 -v schuldrad-data:/data schuldrad
```

The `Dockerfile` is a two-stage build: a `node:26-alpine` build stage runs
`pnpm build:server` and prunes to production dependencies; the runtime
stage strips `npm`/`npx`/`corepack` entirely (the container only ever
needs `node`), runs as the non-root `node` user, and serves the server as
unmodified TypeScript source under Node's native type-stripping — no
bundler, no compile step at runtime. `HEALTHCHECK` polls `/api/health`.
Data lives in the `/data` volume as `schuldrad.db` (SQLite) by default.

### Without Docker

```bash
pnpm build:server
pnpm start
```

`build:server` builds the frontend with `VITE_API_MODE=server` (via the
checked-in `src/web/.env.server`), which switches the client from the
`localStorage` backend to the HTTP backend. `pnpm start` runs
`src/server/main.ts` directly under Node ≥ 26.

### Compose profiles

`docker-compose.yml` defines two profiles:

* **`sqlite`** — a single `schuldrad` service, SQLite in a named volume.
  This is the default, no-infrastructure path:

  ```bash
  docker compose --profile sqlite up --build
  ```

* **`overengineered`** — `schuldrad-overengineered` plus `postgres:17-alpine`
  and `redis:7-alpine`, wired via `EVENT_STORE=postgres`, `DATABASE_URL`,
  and `REDIS_URL`:

  ```bash
  docker compose --profile overengineered up --build
  ```

  This exists because the project's stated principle is that *the system*
  is allowed to be over-engineered even though the code must not be — it is
  not a recommendation for a five-person team's Scrum wheel. SQLite remains
  the default for a reason.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `/data` (container) | directory for `schuldrad.db` |
| `HOST` | `127.0.0.1` | bind address — see § 4 |
| `EVENT_STORE` | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_URL` | — | required when `EVENT_STORE=postgres` |
| `REDIS_URL` | — | optional; enables cross-instance SSE fanout |
| `SCHULDRAD_PASSWORD` | — | optional deployment password — see § 3a |
| `SCHULDRAD_PASSWORD_FILE` | — | optional; path to a file holding the password (Docker secret) — wins over `SCHULDRAD_PASSWORD` if both are set |
| `SCHULDRAD_SECURE_COOKIES` | — | set to `1` to force the `Secure` cookie attribute — see § 3a |

## § 3a Optional password protection

Server mode can require a single deployment password before any team data
is reachable. It is off by default — set `SCHULDRAD_PASSWORD` (or
`SCHULDRAD_PASSWORD_FILE` for a Docker secret) to turn it on:

```bash
docker run -d -p 127.0.0.1:3000:3000 \
  -v schuldrad-data:/data \
  -e SCHULDRAD_PASSWORD=correct-horse-battery-staple \
  schuldrad
```

Or with a Docker secret (the file wins if both are set):

```yaml
services:
  schuldrad:
    build: .
    secrets:
      - schuldrad_password
    environment:
      SCHULDRAD_PASSWORD_FILE: /run/secrets/schuldrad_password
secrets:
  schuldrad_password:
    file: ./schuldrad_password.txt
```

The password is never written to disk by Schuldrad itself and never
logged. At startup, the server derives a verifier with scrypt against a
random salt held only in memory; logins are compared with a
constant-time comparison. Sessions are an in-memory `Map` (12h sliding
TTL, refreshed on use) — **restarting the server logs everyone out**, by
design; there is no session persistence to lose.

The session cookie (`schuldrad_session`) is `HttpOnly` and
`SameSite=Strict`. It also carries `Secure` whenever the request arrives
with `x-forwarded-proto: https` (the standard header a TLS-terminating
reverse proxy sets) or when `SCHULDRAD_SECURE_COOKIES=1` is set explicitly.
If you terminate TLS at a proxy that does not set that header, set the env
var yourself — otherwise the cookie is sent in the clear over the
proxy-to-app hop only if that hop is itself unencrypted, which is fine on
localhost/private networks but not otherwise.

This protects team data behind one shared secret; it is not multi-user
auth (no per-user accounts, roles, or audit trail) — see
[SECURITY.md](../../SECURITY.md) for the exact threat model.

## § 4 Bind address, reverse proxy, and TLS

The server binds to `127.0.0.1` by default — it does not listen on any
network interface other than loopback unless explicitly told to. This is a
deliberate default, not an oversight: Schuldrad ships with no
authentication (see [SECURITY.md](../../SECURITY.md)), so a server
reachable from a network by default would be a server anyone on that
network could read and mutate.

To expose the server:

* **Inside a container**, `HOST=0.0.0.0` is set in the image so the port
  mapping (`-p host:container`) works; the exposure is then controlled by
  what host address you bind the published port to, e.g.
  `-p 127.0.0.1:3000:3000` (loopback-only on the host) versus
  `-p 3000:3000` (all interfaces).
* **On bare metal**, set `HOST=0.0.0.0` only if you also put a reverse
  proxy or VPN boundary in front — never bind to all interfaces on an
  otherwise-open network.
* **TLS** is not terminated by Schuldrad itself; it has no certificate
  handling. Put a reverse proxy (nginx, Caddy, Traefik, your cloud
  provider's load balancer) in front for TLS termination if the server is
  reached over anything other than a private network or VPN tunnel that
  already provides confidentiality.

Schuldrad's own assumption, stated once and relied on throughout: it is
deployed on a trusted network (team LAN, VPN) or behind a reverse proxy
that adds authentication. It is not designed to be placed directly on the
open internet.

## § 5 Migrations at deploy time

SQLite and Postgres migrations (`src/server/migrations.ts`) run
automatically at startup, each inside its own transaction, tracked in
`schema_migrations`. There is no separate "run migrations" step to remember
before starting a new version — starting the server is the migration step.
See [events.md](events.md) § 4 for how to add one.
