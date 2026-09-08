# Security Regulation

*Schuldrad Operations Bureau — Directorate of Security*

Deutsch: no maintained translation exists for this document; the English
text is the sole authority for security matters regardless of which README
you arrived from.

## § 1 Threat model

Schuldrad ships **without authentication or authorization, by design, in
the current release.** There is no login, no session, no API key, no
per-team secret. Anyone who can reach the HTTP server can read and write
every team it holds.

This is a deliberate scope decision, not an oversight: Schuldrad is built
to be run on a network already trusted by its participants — a team's LAN,
or a VPN reaching a team's LAN — and to have a reverse proxy in front of it
whenever it must be reachable from anywhere broader than that. **Do not
expose a Schuldrad server directly to the open internet.** See
[docs/en/deployment.md](docs/en/deployment.md) § 4 for the bind-address and
reverse-proxy guidance that follows from this.

Optional server-mode password protection is planned but not implemented as
of this writing. Until it ships, the network boundary described above is
the only access control this project provides.

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

* Confidentiality of team data from anyone who can reach the server (no
  per-team access control — see § 2).
* Availability — there is no rate limiting; a server exposed to an
  untrusted network can be flooded.
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
