# Optional Postgres And Redis Implementation Plan

> **Historical:** implemented and shipped; checkboxes below were not updated retroactively.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Postgres persistence and optional Redis SSE fanout while preserving SQLite as the default.

**Architecture:** Convert the server persistence contract to async so both SQLite and Postgres fit behind one `EventStore` interface. Add explicit startup configuration that chooses SQLite or Postgres and wraps HTTP broadcasts with Redis only when `REDIS_URL` exists.

**Tech Stack:** Node 26 TypeScript, `node:sqlite`, `pg`, `redis`, Vitest, Docker.

---

### Task 1: Async EventStore Contract

**Files:**
- Modify: `src/server/eventStore.ts`
- Modify: `src/server/commands.ts`
- Modify: `src/server/http.ts`
- Modify tests using `openEventStore`

- [ ] Write failing tests by updating `src/server/eventStore.test.ts` to `await` `load`, `append`, `streamsWithEvent`, and `appliedMigrations`.
- [ ] Run `pnpm test:integration -- src/server/eventStore.test.ts` and verify TypeScript/runtime failures caused by the synchronous implementation.
- [ ] Add an exported `EventStore` interface and make SQLite methods async wrappers around current synchronous work.
- [ ] Update `commands` and `http` to await store-backed methods.
- [ ] Run the event store and API integration tests.

### Task 2: Store Selection And Postgres Adapter

**Files:**
- Create: `src/server/postgresEventStore.ts`
- Create: `src/server/store.ts`
- Modify: `src/server/main.ts`
- Modify: `package.json`

- [ ] Write failing tests for store configuration: default SQLite, Postgres requires `DATABASE_URL`, and unknown `EVENT_STORE` is rejected.
- [ ] Run the targeted test and verify it fails because `openConfiguredEventStore` does not exist.
- [ ] Implement `openConfiguredEventStore`.
- [ ] Implement `openPostgresEventStore` with migrations, optimistic append transaction, stream loading, stream listing, migration listing, and close.
- [ ] Add `pg` dependency and `@types/pg` dev dependency.
- [ ] Run integration tests and typecheck.

### Task 3: Optional Redis Broadcast Hub

**Files:**
- Create: `src/server/broadcast.ts`
- Modify: `src/server/main.ts`
- Modify: `package.json`

- [ ] Write failing tests for in-process broadcasts and Redis publish/subscribe plumbing with fake Redis clients.
- [ ] Run the targeted test and verify it fails because the broadcast hub does not exist.
- [ ] Implement `createBroadcastHub` and `openRedisBroadcastHub`.
- [ ] Wire `main.ts` so `REDIS_URL` opts into Redis fanout.
- [ ] Add `redis` dependency.
- [ ] Run integration tests and typecheck.

### Task 4: Runtime Docs And Container Dependencies

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] Document SQLite default, Postgres env, Redis env, and compose profile.
- [ ] Update Docker runtime so production dependencies are available.
- [ ] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:integration`, and `pnpm build`.
