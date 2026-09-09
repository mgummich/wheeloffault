# Security Regulation

*Schuldrad Operations Bureau — Directorate of Security*

Deutsch: no maintained translation exists for this document; the English
text is the sole authority for security matters regardless of which README
you arrived from.

## § 1 Threat model

Schuldrad ships **without authentication or authorization by default.**
Out of the box there is no login, no session, no API key, no per-team
secret. Anyone who can reach the HTTP server can read and write every team
it holds.

This is a deliberate scope decision, not an oversight: Schuldrad is built
to be run on a network already trusted by its participants — a team's LAN,
or a VPN reaching a team's LAN — and to have a reverse proxy in front of it
whenever it must be reachable from anywhere broader than that. **Do not
expose a Schuldrad server directly to the open internet.** See
[docs/en/deployment.md](docs/en/deployment.md) § 4 for the bind-address and
reverse-proxy guidance that follows from this.

Server mode can optionally require a single deployment password (§ 1a).
Until that env var is set, the network boundary described above is the
only access control this project provides.

## § 1a Optional server-mode password

Setting `SCHULDRAD_PASSWORD` (or `SCHULDRAD_PASSWORD_FILE`) gates every
`/api/*` route except `/api/health` and `/api/auth/*` behind one shared
password, gated by a server-side session cookie. See
[docs/en/deployment.md](docs/en/deployment.md) § 3a for setup and exact
cookie/session semantics.

**What it protects against:** a passer-by who can reach the server (on a
LAN, over a VPN, or through a reverse proxy without its own auth) but does
not know the deployment password. Login attempts are rate-limited (5 per
IP per minute, counted from the moment a request arrives — not from the
moment a wrong password is confirmed, and counting every attempt
including a correct one — so a burst of concurrent requests cannot all
slip in under the limit); the password is verified with scrypt
and a constant-time comparison, never logged, never written to disk.
Sessions slide their expiry on use (12h) but always expire after 7 days
regardless of activity, and every session tied to a still-open SSE stream
on the *same process* is closed the moment it ends — immediately on
logout, or on the next request made against an already-expired session;
a session that simply goes idle past its expiry is only reaped by the
periodic sweep (every 60s), so its SSE stream can stay open up to that
long after expiry — a stolen cookie does not buy an indefinitely live
event feed on that process.

The rate limiter keys on the connecting socket's IP address, which is the
reverse proxy's IP if you run one — meaning by default every request
through the same proxy shares one limit. Set `SCHULDRAD_TRUST_PROXY=1` to
key on `x-forwarded-for` instead, but only behind a proxy that overwrites
that header rather than appending to it, or clients can spoof their way
around the limit. See
[docs/en/deployment.md](docs/en/deployment.md) § 3a. This does not add
anti-DoS machinery beyond that — a single IP behind a shared proxy that
you choose not to unmask can still lock the login for everyone behind it;
that trade-off is deliberate given the deployment target (§ 1).

**Password mode is single-instance only.** Sessions and the login-attempt
map (every attempt, not just failures) live in two separate in-memory
`Map`s (`sessions`, `failures` in `src/server/auth.ts`), per process — there
is no shared store, Redis included (`REDIS_URL` only fans out *domain*
events over SSE, it does not touch auth state; see
[docs/en/deployment.md](docs/en/deployment.md)
§ 3a). Behind more than one replica without sticky sessions: a session
created by instance A is unrecognized by instance B (random 401s on the
same cookie), a logout on A cannot close a stream open on B, and the
effective rate limit is 5×replicas rather than 5. If you must run
`SCHULDRAD_PASSWORD` behind multiple replicas, either pin every client to
one instance (sticky sessions at the load balancer) or run a single
instance of server mode.

**What it does not protect against, and is not trying to:**

* **A single shared secret, not multi-user auth.** There are no
  per-user accounts, no roles, no audit trail of who did what — everyone
  who knows the password is equally privileged, same as everyone reachable
  on the network was before. This is a door lock, not a badge system.
* **Anyone who already has the password**, including a departed team
  member nobody thought to tell. Rotate the password (and restart the
  server, which also revokes every existing session) if that matters to
  you.
* **Network-level eavesdropping without TLS.** The cookie is `HttpOnly` and
  carries `Secure` when a proxy terminates TLS in front of it *and*
  `SCHULDRAD_TRUST_PROXY=1` is set (or `SCHULDRAD_SECURE_COOKIES=1` is set
  explicitly) — the env var is required, not automatic just because a proxy
  happens to terminate TLS. Schuldrad itself never terminates TLS — see § 1
  and [docs/en/deployment.md](docs/en/deployment.md) § 3a and § 4.
* **A compromised server process.** The password lives in that process's
  memory for as long as it runs; anyone with code execution on the host or
  in the container reads it the same way they would read anything else the
  process holds.

**Why static (GitHub Pages) mode cannot be protected the same way:**
static mode has no server — the entire app, including whatever would check
a password, ships as public files to the participant's own browser. There
is no process holding a secret the browser doesn't already have full
access to; a "password check" implemented client-side would just be
obfuscated JavaScript the browser itself executes, trivially bypassed by
reading the source or the network tab. A real password gate needs a party
other than the requester to hold the secret and decide — that party is the
server, which is why this feature exists only in server mode.

## § 1b CSRF and DNS rebinding

Every `/api/*` request is checked against three cheap rules, applied
regardless of whether § 1a's password is enabled — they hold even in the
fully-open default mode. A fourth item below is not a request check but a
cookie attribute, relevant only once § 1a's password is on (in the default
mode there is no session cookie to attach `SameSite` to):

* **Content-Type.** A state-changing request (`POST`/`PUT`/`DELETE`/`PATCH`)
  must be `application/json`. This alone defeats the classic browser CSRF
  trick of a `<form>` posting `text/plain`, which never triggers a CORS
  preflight and would otherwise reach the handler with attacker-controlled
  cross-site credentials attached.
* **Origin.** For a state-changing request (`POST`/`PUT`/`DELETE`/`PATCH`),
  if it carries an `Origin` header, that header must match the request's
  `Host`. Requests with no `Origin` at all — curl, scripts, server-to-server
  calls — are unaffected; browsers only omit `Origin` on requests a
  same-origin script could have made anyway. This check runs only for
  state-changing methods: a `GET` with a mismatched `Origin` is never
  rejected by it (`GET` can't carry a state-changing side effect, so there's
  nothing here for the check to defend).
* **Host allowlist.** Optional. Set `SCHULDRAD_ALLOWED_HOSTS` (comma-separated)
  to reject any request whose `Host` header isn't in the list. This is what
  closes DNS rebinding — an attacker page whose domain resolves to your
  server's address, tricking the browser's same-origin check into treating
  attacker-origin requests as same-origin. Left unset by default, because
  the default has no way to know which hostnames your LAN deployment is
  legitimately reached by; setting it is what actually closes the hole, and
  is worth doing wherever the reachable hostnames are known ahead of time.
  See [docs/en/deployment.md](docs/en/deployment.md) § 3b.
* **`SameSite=Strict` session cookie.** Set on `schuldrad_session` in
  `src/server/auth.ts` — this cookie exists only when § 1a's password is
  enabled (`/api/auth/login` is `404` and issues no cookie otherwise); when
  it does exist, the browser never attaches it to a cross-site request in
  the first place, so a forged request from another origin arrives with no
  session at all, regardless of the checks above. It also carries `Secure`
  when
  `SCHULDRAD_SECURE_COOKIES=1` is set, or when the request is confirmed to
  have arrived over TLS via `SCHULDRAD_TRUST_PROXY=1` — see
  [docs/en/deployment.md](docs/en/deployment.md) § 3a.

If you run a reverse proxy in front of Schuldrad, it **must** forward the
client's original `Host` header unchanged (`proxy_set_header Host $host;`
in nginx). A proxy that rewrites `Host` to the upstream address (nginx's
default `proxy_set_header Host $proxy_host`) makes every browser request's
`Origin` mismatch the `Host` the server sees, so the Origin check above
403s every state-changing request. See
[docs/en/deployment.md](docs/en/deployment.md) § 3b.

Without `SCHULDRAD_ALLOWED_HOSTS` set, a DNS-rebinding attacker can still
reach the API with a same-origin-looking request (Origin and Host both
resolve to the attacker's own domain, so the Origin check passes) — the
Content-Type and Origin checks above narrow the CSRF surface but do not by
themselves close DNS rebinding. Setting the allowlist does.

## § 2 `teamId` is not a capability

`GET /api/teams` returns every team on the server: `[{ teamId, name,
memberCount, spinCount }]`, with no filter — and, unless `SCHULDRAD_PASSWORD`
is set, unauthenticated. When the password is set, `/api/teams` is gated
like every other `/api/*` route except `/api/health` and `/api/auth/*`, so
it requires a valid session. Either way, this means a `teamId` is not a
secret and must not be treated as one — for anyone who *can* reach the
endpoint, knowing a team's UUID grants no more access than not knowing it,
because they can list all of them anyway. Do not build a workflow that
relies on a team URL being hard to guess; the enumeration endpoint makes
that moot. Every write endpoint under `/api/teams/:teamId/...` is reachable
by anyone who can reach the server (and, if a password is set, has a
session), for any `:teamId` listed by `GET /api/teams`.

## § 3 The static-mode fairness asymmetry

In GitHub Pages (static) mode, the commit/reveal protocol runs entirely
inside the participant's own browser, against that browser's own
`localStorage`. The party who could, in principle, cheat is whoever
controls that browser before the reveal — see
[docs/en/fairness.md](docs/en/fairness.md) § 6a for the full mechanism.
Concretely: static mode's fairness guarantee protects participants from
*each other* and from onlookers, not from whoever is sitting at the
keyboard running the draw. If your team's guilt wheel needs to be fair
*against its own operator*, use server mode, where the seed lives in a
database the operator's browser does not control.

## § 4 What is, and is not, protected

**Protected:**

* **Commit/reveal integrity against post-hoc tampering.** Once a
  `SpinCommitted` event is persisted, its `commitment` is a SHA-256 hash
  binding `serverSeed`, `nonce`, and every participant's weight. Nobody —
  including the operator — can alter the recorded weights or seed after
  the fact without the published commitment failing to verify. See
  [docs/en/fairness.md](docs/en/fairness.md).
* **Event immutability.** The event store is append-only; nothing updates
  or deletes a row (see [docs/en/events.md](docs/en/events.md) § 2). A
  compromised server that rewrote a stored `SpinCommitted`/`SpinRevealed`
  pair would break that spin's own commit/reveal check (see
  [docs/en/fairness.md](docs/en/fairness.md) § 6) — this is per-spin
  tamper-evidence, not a hash chain across the whole event history, so it
  only catches tampering with the fields a commitment actually binds.
* **Input validation.** All HTTP input is validated server-side —
  `src/server/validate.ts` for most routes (see [ARCHITECTURE.md](ARCHITECTURE.md)
  for the exact length limits), and `assertPolicy`
  (`src/domain/fairness/policy.ts`) for the fairness-policy body.

  * *Shape and size checks at the HTTP boundary.* Every path parameter
    that names an entity (`teamId`, `memberId`, `poolId`, `spinId`) is
    checked against `id()`'s `^[A-Za-z0-9_-]{1,64}$` shape before it
    reaches a command handler, and the request body as a whole is capped
    at `MAX_BODY` = 64 KiB (`src/server/http.ts`) before any field-level
    check runs, so an oversized or malformed body is rejected cheaply
    rather than parsed first. An over-`MAX_BODY` body returns 400
    `invalid_body` (`src/server/http.ts:434`), not 413 — the size limit
    is enforced by throwing and reusing the same malformed-JSON error
    path, not a distinct HTTP status.

  * *Fairness-policy validation runs in both modes.* The `min`/`max` on
    the policy form's number inputs are UI hints, not the validation
    boundary — they do not constrain a programmatic write. The actual
    enforcement is `assertPolicy`, called from `decide.changePolicy`
    (`src/domain/decisions.ts`), so it runs in both modes: server mode
    via `src/server/http.ts` before the command layer even sees the
    body, and static mode via `src/web/sessionApi.ts`, which calls the
    same domain function directly against `localStorage`.

  * *Names, reasons, and the client seed validate in one place.* Member
    names are length- and NUL-checked by `cleanName`
    (`src/domain/decisions.ts`), shared by every path that creates a
    name in either mode; the immunity reason, appeal reason, and
    `clientSeed` get the same NUL check and length cap from
    `cleanReason` (`src/domain/decisions.ts`) and directly in
    `revealSpin` (`src/domain/fairness/spin.ts`), closing what used to
    be a static-mode-only gap (both used to only `.slice()` the length,
    with no NUL check, in the domain layer — the server's own
    NUL/length check via `str()`/`optionalStr()` never ran for a
    static-mode write). A malicious or buggy client cannot persist a
    malformed policy, name, reason, or `clientSeed` in server mode,
    where the server is a trust boundary the client cannot bypass; in
    static mode there is no such boundary — a client with page access
    can still write directly to its own `localStorage`.

  * *What can be stored is identical; how a bad write is handled is
    not.* `cleanReason`/`revealSpin` cap the same fields at the same
    lengths in both modes, but server mode rejects an over-length
    reason or `clientSeed` outright (400 `field_too_long` from
    `str()`/`optionalStr()` in `src/server/validate.ts`, before the
    domain even runs), while static mode's `cleanReason`/`revealSpin`
    silently truncate to the same limit instead of rejecting. Either
    way that write is confined to the attacker's own browser and
    cannot lie to anyone else about a signed commitment (see
    [docs/en/fairness.md](docs/en/fairness.md) § 6).

  * *One asymmetry remains, deliberately not closed:* static mode does
    not run the `id()` shape check (`^[A-Za-z0-9_-]{1,64}$`) that
    server mode applies to every path parameter *and* to ID-shaped body
    fields (`memberIds` in `POST /api/teams/:teamId/pools` and `PUT
    .../pools/:poolId`, `spinId` in `POST /api/teams/:teamId/spins`;
    `src/server/http.ts`). Every ID a normal UI action generates is
    already a `crypto.randomUUID` value created in the browser
    (`src/web/sessionApi.ts`, `src/web/draw.ts`), the same as server
    mode's own `randomUUID` calls (`src/server/commands.ts`), so the
    gap only matters for a client bypassing the UI to call
    `sessionApi`/`localStorage` directly with a hand-crafted ID —
    `sessionApi.ts` passes such values (e.g. `memberIds`, `spinId`;
    lines 166, 171, 180) straight to the domain with no shape check,
    same as server mode would for a body field that reached `id()`.
    The reason this gap is left open is not that static mode lacks the
    parameters to check — it has them — but that the write is confined
    to the attacker's own browser: unlike server mode, where an
    unchecked ID could reach shared storage other users read, static
    mode's `localStorage` is per-browser, so a malformed ID can only
    corrupt the attacker's own session state, not anyone else's.
    Closing it would mean adding shape-checking to every domain
    function that accepts an ID, for a bypass whose blast radius is
    already that narrow. Documented here rather than closed.

**Not protected**, beyond what §§ 1–3 already say:

* Confidentiality of team data from anyone who can reach the server *and*
  knows the deployment password, if one is set (no per-team access control
  even with § 1a enabled — see § 2). Without § 1a, from anyone who can
  reach the server at all.
* Availability — outside of § 1a's login rate limiting and a fixed cap of
  100 concurrent SSE connections per team (`MAX_SSE_CLIENTS_PER_TEAM` in
  `src/server/http.ts`, returns 503 beyond it), there is no general request
  rate limiting; a server exposed to an untrusted network can still be
  flooded on any other route.
* Anything about the underlying host, container runtime, SQLite/Postgres
  instance, or Redis instance beyond what the Dockerfile itself does (runs
  as non-root, strips the npm CLI from the runtime image, applies OS
  security updates at build time — see
  [docs/en/deployment.md](docs/en/deployment.md) § 3). Operating system and
  infrastructure hardening beyond the container image is the deploying
  team's responsibility.

## § 5 Reporting a vulnerability

Open a private security advisory on the GitHub repository
(`Security` tab → `Report a vulnerability`) rather than a public issue.
Include what you found, how to reproduce it, and which of the guarantees in
§ 4 it breaks (if any) — a report that a `teamId` is guessable is, per § 2,
already a documented non-guarantee, not a vulnerability; a report that
event history can be silently altered without breaking commit/reveal
verification, by contrast, is exactly what this document promises does not
happen and would be treated as a real finding.
