/**
 * Applied in order inside one transaction each and recorded in
 * schema_migrations. Never edit an entry that has shipped; append a new one.
 *
 * `sql` runs against SQLite, `pgSql` against Postgres. Write each dialect's
 * SQL literally rather than deriving one from the other.
 */
export const migrations: { id: string; sql: string; pgSql: string }[] = [
  {
    id: '001_events',
    sql: `
      CREATE TABLE events (
        position   INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id  TEXT    NOT NULL,
        version    INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        payload    TEXT    NOT NULL,
        at         TEXT    NOT NULL,
        UNIQUE (stream_id, version)
      );
      CREATE INDEX events_type ON events (type);
    `,
    pgSql: `
      CREATE TABLE events (
        position   BIGSERIAL PRIMARY KEY,
        stream_id  TEXT    NOT NULL,
        version    INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        payload    JSONB   NOT NULL,
        at         TEXT    NOT NULL,
        UNIQUE (stream_id, version)
      );
      CREATE INDEX events_type ON events (type);
    `,
  },
];
