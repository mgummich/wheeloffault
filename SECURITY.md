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
moment a wrong password is confirmed — so a burst of concurrent requests
cannot all slip in under the limit); the password is verified with scrypt
and a constant-time comparison, never logged, never written to disk.
Sessions slide their expiry on use (12h) but always expire after 7 days
regardless of activity, and every session tied to a still-open SSE stream
is closed the moment it ends (logout, expiry, or the periodic sweep) —
a stolen cookie does not buy an indefinitely live event feed.

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

**What it does not protect against, and is not trying to:**

* **A single shared secret, not multi-user auth.** There are no
  per-user accounts, no roles, no audit trail of who did what — everyone
  who knows the password is equally privileged, same as everyone reachable
  on the network was before. This is a door lock, not a badge system.
* **Anyone who already has the password**, including a departed team
  member nobody thought to tell. Rotate the password (and restart the
  server, which also revokes every existing session) if that matters to
  you.
* **Network-level eavesdropping without TLS.** The cookie is `HttpOnly`
  and `Secure` when a proxy terminates TLS in front of it, but Schuldrad
  itself never terminates TLS — see § 1 and
  [docs/en/deployment.md](docs/en/deployment.md) § 4.
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
fully-open default mode:

* **Content-Type.** A state-changing request (`POST`/`PUT`/`DELETE`/`PATCH`)
  must be `application/json`. This alone defeats the classic browser CSRF
  trick of a `<form>` posting `text/plain`, which never triggers a CORS
  preflight and would otherwise reach the handler with attacker-controlled
  cross-site credentials attached.
* **Origin.** If a request carries an `Origin` header, it must match the
  request's `Host`. Requests with no `Origin` at all — curl, scripts,
  server-to-server calls — are unaffected; browsers only omit `Origin` on
  requests a same-origin script could have made anyway.
* **Host allowlist.** Optional. Set `SCHULDRAD_ALLOWED_HOSTS` (comma-separated)
  to reject any request whose `Host` header isn't in the list. This is what
  closes DNS rebinding — an attacker page whose domain resolves to your
  server's address, tricking the browser's same-origin check into treating
  attacker-origin requests as same-origin. Left unset by default, because
  the default has no way to know which hostnames your LAN deployment is
  legitimately reached by; setting it is what actually closes the hole, and
  is worth doing wherever the reachable hostnames are known ahead of time.
  See [docs/en/deployment.md](docs/en/deployment.md) § 3b.

Without `SCHULDRAD_ALLOWED_HOSTS` set, a DNS-rebinding attacker can still
reach the API with a same-origin-looking request (Origin and Host both
resolve to the attacker's own domain, so the Origin check passes) — the
Content-Type and Origin checks above narrow the CSRF surface but do not by
themselves close DNS rebinding. Setting the allowlist does.

## § 2 `teamId` is not a capability

`GET /api/teams` returns every team on the server: `[{ teamId, name,
memberCount, spinCount }]`, unauthenticated, no filter. This means a
`teamId` is not a secret and must not be treated as one — knowing a team's
UUID grants no more access than not knowing it, because anyone who can
reach the server can list all of them anyway. Do not build a workflow that
relies on a team URL being hard to guess; the enumeration endpoint makes
that moot. Every write endpoint under `/api/teams/:id/...` is reachable by
anyone who can reach the server, for any `:id` listed by `GET /api/teams`.

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
  compromised server that overwrote history would have to lie
  consistently across every replay and every cached client, which the
  commit/reveal hash chain makes detectable.
* **Input validation.** All HTTP input is validated server-side
  (`src/server/validate.ts`) independent of anything the browser sends —
  a malicious or buggy client cannot inject a malformed event.

**Not protected**, beyond what §§ 1–3 already say:

* Confidentiality of team data from anyone who can reach the server *and*
  knows the deployment password, if one is set (no per-team access control
  even with § 1a enabled — see § 2). Without § 1a, from anyone who can
  reach the server at all.
* Availability — outside of § 1a's login rate limiting, there is no
  general request rate limiting; a server exposed to an untrusted network
  can still be flooded on any other route.
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
