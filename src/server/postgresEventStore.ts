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
      ...upcast({ ...payload, type: row.type, at: row.at }),
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
          (err instanceof Error && (err as Error & { code?: string }).code === '23505')
        ) {
          throw new ConcurrencyError(streamId, expectedVersion);
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async streamsWithEvent(type: DomainEvent['type']): Promise<string[]> {
      // Ordered by first occurrence, matching the SQLite adapter's ORDER BY position.
      const result = await pool.query<{ stream_id: string }>(
        'SELECT stream_id FROM events WHERE type = $1 GROUP BY stream_id ORDER BY MIN(position)',
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

// Arbitrary fixed key for the session-level advisory lock guarding migrations
// across concurrently booting instances.
const MIGRATION_LOCK_KEY = 727_100_1;

async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      const appliedResult = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
      const applied = new Set(appliedResult.rows.map((r) => r.id));
      for (const m of migrations) {
        if (applied.has(m.id)) continue;
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
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

const PORTING_RULES: [RegExp, string][] = [
  [/position\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/, 'position   BIGSERIAL PRIMARY KEY'],
  [/payload\s+TEXT\s+NOT\s+NULL/, 'payload    JSONB   NOT NULL'],
];

// SQLite-only tokens that must not survive porting. If one of these is still
// present after applying every matching rule above, the migration contains a
// SQLite-ism with no Postgres equivalent registered — fail loudly rather than
// run invalid SQL against Postgres.
const UNPORTABLE_TOKENS = [/AUTOINCREMENT/];

/**
 * Ports SQLite migration SQL to Postgres: applies any porting rule whose
 * pattern matches (a rule simply not matching is fine — most migrations,
 * e.g. `ADD COLUMN`, need no porting at all) and throws if a known
 * SQLite-only token survives, so SQLite-specific SQL never silently reaches
 * Postgres.
 */
export function toPostgresMigration(sql: string): string {
  let ported = sql;
  for (const [pattern, replacement] of PORTING_RULES) {
    if (pattern.test(ported)) {
      ported = ported.replace(pattern, replacement);
    }
  }
  for (const token of UNPORTABLE_TOKENS) {
    if (token.test(ported)) {
      throw new Error(`Migration contains unported SQLite-ism: ${token}`);
    }
  }
  return ported;
}
