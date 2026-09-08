# Schuldrad — Architecture

Schuldrad is a self-hosted, installable PWA tool for the Scrum ritual of
"who is at fault this time?". It replaces wheelofnames.com with a
deliberately over-professional wheel of responsibility, with auditable
fairness, full history, and guilt reports.

Guiding principle: **The system may be over-engineered, the code may not.**

## 1. Overview

```
Browser (PWA, React)                       Server (Node 26, no framework)
┌──────────────────────────┐   HTTP/JSON   ┌────────────────────────────────┐
│ Views                     │ ────────────▶ │ Command handlers                │
│ Wheel animation            │               │   loads stream → domain function│
│ Guilt report/statistics   │ ◀──────────── │   → events → event store       │
│ Verifier (Web Crypto)     │   SSE         │ Projections (pure functions)   │
└──────────────────────────┘               │ SQLite (node:sqlite, 1 file)   │
              ▲                            └────────────────────────────────┘
              └── same domain module (src/domain) on both sides
```

A single npm package, three source folders:

| Folder        | Runs in         | May import from | Contents |
|---------------|------------------|------------------|----------|
| `src/domain`  | Browser + Node   | only `src/domain` | Events, state building, fairness, projections, public HTTP views (`views.ts`). Pure functions, no I/O. |
| `src/server`  | Node             | `src/domain`     | HTTP server, event store (SQLite), command handlers, SSE. |
| `src/web`     | Browser          | `src/domain`     | React UI, animation, service worker, verifier UI. |

`src/web` uses `src/domain/views.ts` (`TeamView`, `SpinView`, `teamView`,
`spinView`) both for the HTTP response shapes and for session mode — no
exception needed anymore, the file lives in the domain.

The domain knows nothing about HTTP, SQLite, or React. The fairness
verifier in the browser is literally the same function as on the server.

## 2. Domain model

```
Team          Container for everything. One event stream per team.
Member        Person on a team. Never deleted, only deactivated.
Pool          Named subset of members (e.g. "Backend", "Daily"). Renamable,
              deletable; a deleted pool's draw history is retained.
Spin          A draw: commit (server binds seed + weights) → reveal (result).
FairnessPolicy Active weight modifiers plus their parameters. Visible in the UI.
WeightModifier Pure function  (weights, context) → weights.
Appeal        Objection to a guilt verdict; outcome "upheld" or "rejected".
Immunity      One-time protection: weight 0 on the next draw, consumed by it.
              Can be revoked before it's consumed.
```

### Events (persisted contract, `src/domain/events.ts`)

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

Every event additionally carries `type`, `at` (ISO time) and — in the
database — `streamId`, `version` (1-based, gap-free per stream) and
`position` (global). Events are immutable. An event type is never
reinterpreted; new meaning = new type. Fields may be added optionally,
never removed or renamed (`upcast` in `events.ts` is the only place legacy
data compatibility is allowed to live, currently empty).

## 3. Command flow

```
Command  ──▶  decide(state, command)  ──▶  Event[]  ──▶  append(streamId, expectedVersion, events)
                     ▲                                          │
              state = replay(events)                            ▼
                                                         Projections from replay()
```

* `replay(events): TeamState` in `src/domain/team.ts` folds the stream into
  a state. No snapshotting: a team has a few thousand events, which SQLite
  reads in milliseconds.
* Decision functions (`addMember`, `commitSpin`, `revealSpin`, …) are pure
  functions `(state, input) → Event[]` and throw `DomainError` on invalid
  transitions.
* Per command, the server: loads the stream → decides → appends with
  `expectedVersion = state.version`. On conflict (someone was faster) →
  reload the stream, decide the command again, up to 3 attempts.

### Concurrency & idempotency

* `events(stream_id, version)` is `UNIQUE`. Two concurrent writers can
  never both write version n+1.
* Spin IDs come from the client (UUID). `commitSpin` with an already
  existing spin ID is a no-op that returns the existing spin. A retry
  therefore never creates two official draws.
* At most one spin per team is "committed but not revealed". A further
  commit is rejected with `409` and the open spin's ID; the client resumes
  the open spin.
* `revealSpin` with an identical `clientSeed` is idempotent; a differing
  `clientSeed` after a successful reveal → `409`.
* Crash between commit and reveal: the commit is persisted, the team sees
  "draw in progress" after reload and can finish it. No winner without a
  persisted `SpinRevealed`. A second browser that wants to finish the open
  spin with its own `clientSeed` gets `409` and takes over the already
  persisted result.
* An overturned spin (appeal upheld) counts statistically as if it never
  happened: neither a hit nor an expected value.

## 4. Fairness protocol (commit/reveal)

```
1. eligibleMembers(state, poolId)                 active members ∩ pool
2. calculateWeights(participants, policy, state)   modifiers in fixed order
3. Server: serverSeed = 32 random bytes (crypto.getRandomValues)
   commitment = SHA-256( canonicalJson({ serverSeed, nonce, participants }) )
   → SpinCommitted { commitment, nonce, participants (with weights), serverSeed }
   The serverSeed lives in the event (otherwise an open spin wouldn't survive
   a restart), but is never served over HTTP before the reveal (`domain/views.ts`).
   Whoever can read the database can predict the result — the database is the
   trust boundary.
4. Client supplies clientSeed (arbitrary string, default: 16 random bytes, hex)
5. digest = HMAC-SHA-256(key = serverSeed, msg = `${commitment}:${clientSeed}:${nonce}`)
   r = uint64(digest[0..8]) mod Σweights
   selected = first participant whose cumulative weight > r
   → SpinRevealed { serverSeed, clientSeed, digest, selectedMemberId }
6. The animation drives to the persisted result.
```

Weights are integers (base 1000 = "1.000×"), so the draw is exact across
platforms. Participants are sorted by `memberId` (stable order, part of the
commitment).

Invariants (backed by deterministic and property tests):

```
same inputs             = same result
inactive member         = cannot be drawn
weight 0                = cannot be drawn
weights finite, ≥ 0
all weights 0           = error, no spin
participant order       stable
modifier order          deterministic (fixed list in modifiers.ts)
commitment binds seed + weights
reveal reproduces commitment
browser verifier reproduces server
```

Modifiers (`src/domain/fairness/modifiers.ts`), all `weights + context → weights`:

```
uniform     starting weight 1000 for everyone
pity        +X % per draw without a hit since the member's last guilt
cooldown    weight 0 for N draws after a guilt (if this would exclude
            everyone, it is skipped for this draw and logged with factor 1.000)
exhaustion  −X % per guilt within the last N draws
newcomer    ×factor for members with fewer than N participations
manual      explicit factor per member
immunity    weight 0 if an immunity applies (consumed by the spin)
```

Gamification never changes weights. Every weight change is visible via the
active `FairnessPolicy` and documented per participant in the
`SpinCommitted` event.

## 5. Projections (read models)

All read models are pure functions over `TeamState` in `src/domain/projections/`:

```
memberReport(state, memberId)   Guilt report: hits, guilt rate, expected value, guilt index,
                                time since last guilt, streaks, fairness deviation, achievements,
                                guilt points, compensation minutes
teamStatistics(state)           Hall of shame, ranking, distribution, fairness overview
spinHistory(state)              chronological list including appeals
```

None of this is stored. The event history is the sole source of truth;
"rebuild a projection" means: reload the page.

## 6. HTTP contract

```
GET  /api/teams                              [{ teamId, name, memberCount, spinCount }]
POST /api/teams                 { name }     → 201 TeamView
GET  /api/teams/:id                          TeamView (state + statistics)
POST /api/teams/:id/members     { name }  |  { names: [...] }   insert a list
POST /api/teams/:id/members/:mid/deactivate
POST /api/teams/:id/members/:mid/reactivate
POST   /api/teams/:id/members/:mid/immunity   { reason }
DELETE /api/teams/:id/members/:mid/immunity   revokes the oldest immunity
PUT    /api/teams/:id/policy      FairnessPolicy
POST   /api/teams/:id/pools       { name, memberIds }
PUT    /api/teams/:id/pools/:pid  { memberIds }
POST   /api/teams/:id/pools/:pid/rename  { name }
DELETE /api/teams/:id/pools/:pid
POST /api/teams/:id/spins       { spinId, poolId? }        → SpinCommitted data   (409 on open spin)
POST /api/teams/:id/spins/:sid/reveal { clientSeed }       → SpinRevealed data
POST /api/teams/:id/spins/:sid/appeal { reason }
POST /api/teams/:id/spins/:sid/appeal/uphold
POST /api/teams/:id/spins/:sid/appeal/reject
GET  /api/teams/:id/members/:mid/report      Guilt report
GET  /api/teams/:id/events                   SSE: one `event: appended` per new event
GET  /api/health
POST /api/auth/login             { password } → sets session cookie (only when auth is enabled)
POST /api/auth/logout            clears the session cookie
GET  /api/auth/status                        { enabled, authenticated }
```

Errors: `{ error: string, code: string }` with 400 (invalid input), 404,
409 (conflict). `code` is a stable, machine-readable identifier that the
client localizes (`src/web/apiError.ts`, `src/web/i18n/`); the human
`error` message is English and only a fallback for unknown codes. All
input is explicitly validated (`src/server/validate.ts`; the
FairnessPolicy in `src/domain/fairness/policy.ts`, because the browser
uses the same check).

There is no authentication by default: Schuldrad is meant for a trusted
network (team LAN, VPN); anyone running it publicly puts a reverse proxy
with auth in front of it. Server mode can optionally require a single
shared deployment password (`SCHULDRAD_PASSWORD`/`SCHULDRAD_PASSWORD_FILE`)
gating every `/api/*` route except `/api/health` and `/api/auth/*` behind a
server-side session cookie (`src/server/auth.ts`). This is a door lock, not
multi-user auth — see [SECURITY.md](SECURITY.md) for the full threat
model, what it protects against, and what it does not.

The client holds no domain state of its own. Every mutation returns the
fresh `TeamView`, which the client adopts directly; it also reloads
`GET /api/teams/:id` on every SSE message (the echo of its own append is a
harmless double fetch).

## 7. Persistence

SQLite via `node:sqlite` is the default: one file, one table that counts:

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

Migrations: numbered entries in `src/server/migrations.ts`, each applied in
a transaction, logged in `schema_migrations`. Applied migrations are never
edited.

Optionally, the same event store contract can run on Postgres:

```bash
EVENT_STORE=postgres DATABASE_URL=postgres://... pnpm start
```

The domain and projections are unchanged. Postgres stores the same events
in the same logical table; `payload` is `JSONB` there, `position` is
`BIGSERIAL`. Concurrency remains optimistic via the gap-free stream
version and `UNIQUE (stream_id, version)`. SQLite deliberately stays the
no-infrastructure path.

## 8. Realtime

Server-Sent Events. The server holds a set of open responses per team and
writes `event: appended` after every successful append. The client then
reloads the team state. No WebSocket.

Optionally, Redis can be enabled as a pure broadcast fanout:

```bash
REDIS_URL=redis://localhost:6379 pnpm start
```

Redis is not a cache and not a second source of truth. One server
publishes event metadata after persisted appends; other instances deliver
it to their local SSE clients.

## 9. Frontend

React 19 + Vite. No router package: the hash (`#/team/:id/spin`) is the
route. No state management package: `TeamView` from the server plus a
handful of `useState`. Animations (`src/web/wheel/`) receive the persisted
result as a prop and must not own domain state. They are skippable and
respect `prefers-reduced-motion`.

Guide through `src/web`:

```
api.ts           Facade: picks between two backends via VITE_API_MODE
serverApi.ts     HTTP client; exports the shared contract `type Api`
sessionApi.ts    In-browser event store (localStorage) with the same Api
apiError.ts      ApiError for both backends + errorMessage() (localized via code, § 6)
draw.ts          performDraw(): commit → reveal including 409 resumption
useTeam.ts       load team, SSE refresh
route.ts         hash router; views/ are the pages; wheel/ the visualizations
AnimPanel.tsx    animation settings (localStorage via animSettings.ts)
share.ts         team card (canvas PNG) + ShareDialog.tsx (native <dialog>)
```

PWA: `manifest.webmanifest` + a hand-written service worker (app-shell
cache; `/api` is never touched, history always comes from the server).

`src/web` imports types (`TeamView`, `SpinView`) and the pure view
functions from `src/domain/views.ts` — that is the HTTP contract, not
server state (see the table in section 1).

## 10. Deployment

One container (`Dockerfile`, multi-stage): Vite build → static files; the
server runs as unmodified TypeScript source directly under Node ≥ 26
(native type-stripping, no bundler). Volume for `data/schuldrad.db`.
`PORT` and `DATA_DIR` via environment variable. No reverse proxy required.

## 11. Verification loop

`pnpm verify` = format → lint → typecheck → unit/property → integration →
build. E2E (`pnpm e2e`) with Playwright against the built server. CI
(`.github/workflows/ci.yml`) additionally runs container build, `pnpm
audit`, a Trivy scan, and SBOM generation.
