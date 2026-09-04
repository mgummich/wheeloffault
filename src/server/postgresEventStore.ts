import pg from 'pg';
import type { DomainEvent, StoredEvent } from '../domain/events.ts';
import { upcast } from '../domain/events.ts';
import { ConcurrencyError, type EventStore } from './eventStore.ts';
import { migrations } from './migrations.ts';

type PgRow = {
  position: string;
  stream_id: string;
  version: number;
  type: string;
  payload: string | Record<string, unknown>;
  at: string;
};

export async function openPostgresEventStore(connectionString: string): Promise<EventStore> {
  const pool = new pg.Pool({ connectionString });
  await migrate(pool);

  const toStored = (row: PgRow): StoredEvent => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return {
      ...(upcast({ ...payload, type: row.type, at: row.at }) as DomainEvent),
      streamId: row.stream_id,
      version: row.version,
      position: Number(row.position),
    };
  };

  return {
    async load(streamId: string): Promise<StoredEvent[]> {
      const result = await pool.query<PgRow>(
        'SELECT position, stream_id, version, type, payload, at FROM events WHERE stream_id = $1 ORDER BY version',
        [streamId],
      );
      return result.rows.map(toStored);
    },

    async append(
      streamId: string,
      expectedVersion: number,
      events: DomainEvent[],
    ): Promise<StoredEvent[]> {
      if (events.length === 0) return [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const versionResult = await client.query<{ version: number }>(
          'SELECT COALESCE(MAX(version), 0)::int AS version FROM events WHERE stream_id = $1',
          [streamId],
        );
        const current = versionResult.rows[0]?.version ?? 0;
        if (current !== expectedVersion) throw new ConcurrencyError(streamId, expectedVersion);

        const stored: StoredEvent[] = [];
        for (const [i, event] of events.entries()) {
          const { type, at, ...payload } = event;
          const result = await client.query<PgRow>(
            `INSERT INTO events (stream_id, version, type, payload, at)
             VALUES ($1, $2, $3, $4::jsonb, $5)
             RETURNING position, stream_id, version, type, payload, at`,
            [streamId, expectedVersion + i + 1, type, JSON.stringify(payload), at],
          );
          const row = result.rows[0];
          if (!row) throw new Error('Postgres append returned no row');
          stored.push(toStored(row));
        }
        await client.query('COMMIT');
        return stored;
      } catch (err) {
        await client.query('ROLLBACK');
        if (
          err instanceof ConcurrencyError ||
          (err instanceof Error &&
            /duplicate key value violates unique constraint/.test(err.message))
        ) {
          throw new ConcurrencyError(streamId, expectedVersion);
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async streamsWithEvent(type: DomainEvent['type']): Promise<string[]> {
      const result = await pool.query<{ stream_id: string }>(
        'SELECT DISTINCT stream_id FROM events WHERE type = $1 ORDER BY stream_id',
        [type],
      );
      return result.rows.map((r) => r.stream_id);
    },

    async appliedMigrations(): Promise<string[]> {
      const result = await pool.query<{ id: string }>(
        'SELECT id FROM schema_migrations ORDER BY id',
      );
      return result.rows.map((r) => r.id);
    },

    close() {
      return pool.end();
    },
  };
}

async function migrate(pool: pg.Pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const appliedResult = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.id));
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(toPostgresMigration(m.sql));
      await client.query('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [
        m.id,
        new Date().toISOString(),
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

function toPostgresMigration(sql: string): string {
  return sql
    .replace('position   INTEGER PRIMARY KEY AUTOINCREMENT', 'position   BIGSERIAL PRIMARY KEY')
    .replace('payload    TEXT    NOT NULL', 'payload    JSONB   NOT NULL');
}
