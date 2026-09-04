# Optional Postgres And Redis Design

## Summary

Schuldrad keeps SQLite as the zero-config default. Operators can opt into
Postgres for the event store with `EVENT_STORE=postgres` and `DATABASE_URL`.
Operators can also opt into Redis-backed SSE fanout with `REDIS_URL`, which is
useful when multiple Schuldrad server instances are running.

## Architecture

The domain remains unchanged. `src/server` continues to depend on an
`EventStore` contract with `load`, `append`, `streamsWithEvent`,
`appliedMigrations`, and `close`. SQLite and Postgres are separate adapters
behind that contract. Because Postgres I/O is asynchronous, the contract
becomes promise-based and the command and HTTP layers await it.

Redis is not a cache and does not store read models. The HTTP server still owns
local SSE clients. A broadcast hub can publish append notifications to Redis and
subscribe to the same channel so every instance can notify its own clients.
Without Redis, broadcasts stay in process.

## Configuration

Default:

```bash
pnpm start
```

uses SQLite at `${DATA_DIR:-data}/schuldrad.db`.

Optional Postgres:

```bash
EVENT_STORE=postgres DATABASE_URL=postgres://schuldrad:schuldrad@localhost:5432/schuldrad pnpm start
```

Optional Redis fanout:

```bash
REDIS_URL=redis://localhost:6379 pnpm start
```

`REDIS_URL` may be used with either SQLite or Postgres, although it is mainly
intended for horizontally scaled Postgres deployments.

## Data Flow

Commands load events through the configured store, replay domain state, produce
new events, append with expected stream version, and broadcast stored events.
The Postgres adapter enforces optimistic concurrency with the same stream
version check and unique `(stream_id, version)` constraint used by SQLite.

## Error Handling

Missing Postgres configuration fails startup with a clear error. Unknown
`EVENT_STORE` values fail startup. Redis connection failure fails startup when
`REDIS_URL` is configured, because an operator explicitly requested cross-process
fanout. Runtime SSE write failures remain non-fatal after persistence succeeds.

## Testing

Unit/integration tests cover the async SQLite contract, command and HTTP layers,
store selection configuration, and Redis broadcast hub behavior with fake
clients. The Postgres adapter is typechecked and uses the same SQL schema shape;
live Postgres tests are intentionally not mandatory for the default test suite.
