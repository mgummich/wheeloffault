import { DatabaseSync } from 'node:sqlite';
import type { DomainEvent, StoredEvent } from '../domain/events.ts';
import { upcast } from '../domain/events.ts';
import { migrations } from './migrations.ts';

export class ConcurrencyError extends Error {
  constructor(streamId: string, expectedVersion: number) {
    super(`Stream ${streamId} wurde seit Version ${expectedVersion} verändert`);
    this.name = 'ConcurrencyError';
  }
}

export type EventStore = {
  load(streamId: string): Promise<StoredEvent[]>;
  append(streamId: string, expectedVersion: number, events: DomainEvent[]): Promise<StoredEvent[]>;
  streamsWithEvent(type: DomainEvent['type']): Promise<string[]>;
  appliedMigrations(): Promise<string[]>;
  close(): void | Promise<void>;
};

/** Opens (and migrates) the database. Use ':memory:' in tests. */
export function openEventStore(path: string): EventStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);

  const insert = db.prepare(
    'INSERT INTO events (stream_id, version, type, payload, at) VALUES (?, ?, ?, ?, ?)',
  );
  const selectStream = db.prepare(
    'SELECT position, stream_id, version, type, payload, at FROM events WHERE stream_id = ? ORDER BY version',
  );
  const selectStreamsByType = db.prepare(
    'SELECT DISTINCT stream_id FROM events WHERE type = ? ORDER BY position',
  );
  const selectVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) AS version FROM events WHERE stream_id = ?',
  );

  type Row = {
    position: number;
    stream_id: string;
    version: number;
    type: string;
    payload: string;
    at: string;
  };

  const toStored = (row: Row): StoredEvent => ({
    ...upcast({ ...JSON.parse(row.payload), type: row.type, at: row.at }),
    streamId: row.stream_id,
    version: row.version,
    position: row.position,
  });

  return {
    async load(streamId: string): Promise<StoredEvent[]> {
      return (selectStream.all(streamId) as Row[]).map(toStored);
    },

    /**
     * Appends atomically at versions expectedVersion+1…; the UNIQUE constraint
     * turns a lost race into a ConcurrencyError instead of a fork in history.
     */
    async append(
      streamId: string,
      expectedVersion: number,
      events: DomainEvent[],
    ): Promise<StoredEvent[]> {
      if (events.length === 0) return [];
      db.exec('BEGIN IMMEDIATE'); // throws itself if busy; nothing to roll back then
      try {
        // Versions must stay gapless: the UNIQUE index alone would accept an append
        // "in the future" from a caller whose expectedVersion is too high.
        const current = (selectVersion.get(streamId) as { version: number }).version;
        if (current !== expectedVersion) throw new ConcurrencyError(streamId, expectedVersion);
        const stored: StoredEvent[] = [];
        events.forEach((event, i) => {
          const { type, at, ...payload } = event;
          const version = expectedVersion + i + 1;
          const result = insert.run(streamId, version, type, JSON.stringify(payload), at);
          stored.push({ ...event, streamId, version, position: Number(result.lastInsertRowid) });
        });
        db.exec('COMMIT');
        return stored;
      } catch (err) {
        db.exec('ROLLBACK');
        if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
          throw new ConcurrencyError(streamId, expectedVersion);
        }
        throw err;
      }
    },

    async streamsWithEvent(type: DomainEvent['type']): Promise<string[]> {
      return (selectStreamsByType.all(type) as { stream_id: string }[]).map((r) => r.stream_id);
    },

    async appliedMigrations(): Promise<string[]> {
      return (
        db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: string }[]
      ).map((r) => r.id);
    },

    close() {
      db.close();
    },
  };
}

function migrate(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        m.id,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
