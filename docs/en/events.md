Deutsch → [events.md](../de/events.md)

# Event Contract

*Schuldrad Operations Bureau — Directorate of Records*

`src/domain/events.ts` defines the persisted contract for Schuldrad's event
store. This document is the operating rules for that contract: what may
change, what may never change, and how to add a migration without breaking
history already on disk.

## § 1 The 17 event types

One event stream per team (`streamId` = team id). Every event carries
`type`, its type-specific payload, `at` (ISO 8601 timestamp), and — once
stored — `streamId`, `version` (1-based, gap-free per stream), and
`position` (global, monotonic across all streams).

| # | Type | Payload |
|---|---|---|
| 1 | `TeamCreated` | `{ teamId, name }` |
| 2 | `MemberJoined` | `{ memberId, name }` |
| 3 | `MemberDeactivated` | `{ memberId }` |
| 4 | `MemberReactivated` | `{ memberId }` |
| 5 | `PoolCreated` | `{ poolId, name }` |
| 6 | `PoolMembershipChanged` | `{ poolId, memberIds }` |
| 7 | `PoolRenamed` | `{ poolId, name }` |
| 8 | `PoolDeleted` | `{ poolId }` |
| 9 | `FairnessPolicyChanged` | `{ policy }` |
| 10 | `SpinCommitted` | `{ spinId, poolId, nonce, commitment, participants: [{memberId, weight}], modifiers: [{name, factors}], serverSeed }` |
| 11 | `SpinRevealed` | `{ spinId, serverSeed, clientSeed, digest, selectedMemberId }` |
| 12 | `GuiltAppealed` | `{ spinId, reason }` |
| 13 | `AppealUpheld` | `{ spinId }` |
| 14 | `AppealRejected` | `{ spinId }` |
| 15 | `ImmunityGranted` | `{ memberId, reason }` |
| 16 | `ImmunityConsumed` | `{ memberId, spinId }` |
| 17 | `ImmunityRevoked` | `{ memberId }` |

Members are never deleted, only deactivated/reactivated. Pools are
deletable, but a deleted pool's draw history remains in the events that
reference it — deleting a pool removes a grouping, not a record.

## § 2 Immutability rules

Events, once appended, are historical fact and are never edited or
deleted. This is enforced by the storage layer (`UNIQUE (stream_id,
version)` plus append-only access) and by convention in the domain code.
The rules that follow from it:

1. **A stored event's `type` is never reinterpreted.** If behavior needs to
   change in a way that would alter what an already-stored event of a given
   type means, that is a new event type, not a new meaning for the old one.
2. **Fields may be added, optionally.** A new optional field is safe:
   old events simply lack it, and reading code must treat its absence as
   meaningful (not as "malformed").
3. **Fields are never removed or renamed.** Renaming or dropping a field
   changes what old, already-persisted events mean without changing their
   bytes — this is silent corruption of history, worse than an editing bug
   because nothing errors.
4. **A spin's outcome is never rewritten.** An upheld appeal
   (`AppealUpheld`) does not delete or alter `SpinCommitted`/`SpinRevealed`;
   it is a new event layered on top that changes how projections *count*
   the spin (excluded from hit/expectation statistics — see
   [ARCHITECTURE.md](../../ARCHITECTURE.md) § 3), not what happened.

## § 3 The upcast seam

`upcast(event: DomainEvent): DomainEvent` in `src/domain/events.ts` is the
**only** place old, on-disk event shapes may be adapted to the current
in-memory contract. It runs once per event as it is read back from storage,
before `replay()` folds it into state. As of this writing it is the
identity function — nothing has changed shape since v1 — but it exists so
that when something does, the fix has exactly one seam rather than being
scattered across every reader.

What belongs in `upcast`, and what does not:

* **Belongs:** giving an old event a default for a field that did not exist
  when it was written (e.g. a new optional field that projections now read
  unconditionally — upcast fills it in so projections don't need an
  `?? default` at every call site).
* **Does not belong:** business logic, validation, or anything that depends
  on other events in the stream. `upcast` sees one event in isolation.

## § 4 Adding a migration

A "migration" here has two, mostly independent, layers: the domain-level
event shape (handled by `upcast`, § 3) and the storage schema (handled per
dialect, below). Most changes only need one.

### Domain-level (event shape)

1. Add the new field to the relevant variant in the `EventBody` union in
   `src/domain/events.ts`, as **optional**.
2. Update the event-producing decision function
   (`src/domain/decisions.ts` / `src/domain/fairness/spin.ts`) to always
   set the new field going forward.
3. If projections need the field on *old* events too, give `upcast` a case
   for that event type that supplies a default.
4. Never touch the type or payload shape of an event already described in
   § 1 in a way that changes what an *old, stored* instance means.

### Storage-level: SQLite and Postgres

`src/server/migrations.ts` holds a numbered, append-only list. Each entry is
`{ id, sql, pgSql }` — `sql` runs against SQLite, `pgSql` against Postgres —
applied once inside its own transaction, and recorded in `schema_migrations`
so it never runs twice. Write each dialect's SQL literally; there is no
rewriting between them. To add one:

```ts
{
  id: '002_whatever',
  sql: `ALTER TABLE events ADD COLUMN whatever TEXT;`,
  pgSql: `ALTER TABLE events ADD COLUMN whatever TEXT;`,
}
```

Append a new entry with the next number. **Never edit a migration that has
already shipped** — a migration that ran differently on different
deployments is worse than one that never ran. If a shipped migration was
wrong, ship a corrective migration. See `EVENT_STORE=postgres` in
[deployment.md](deployment.md) for how the dialect is selected at runtime.

## § 5 Why not just snapshot?

A team accumulates some thousand events over its lifetime; SQLite reads and
folds (`replay()`) that in milliseconds. There is no snapshotting, so there
is no snapshot-invalidation problem, and no "projection is stale, rebuild
it" state to manage — a projection is only ever the pure fold of the full
event stream. "Rebuild the projection" means: reload the page.
