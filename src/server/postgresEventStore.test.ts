import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../domain/events.ts';
import { ConcurrencyError } from './eventStore.ts';
import { openPostgresEventStore } from './postgresEventStore.ts';

/**
 * Runs against a real Postgres — the parity test in migrations.test.ts is
 * only a string comparison of `sql` vs `pgSql`; it never proves the pgSql
 * actually runs, that the advisory lock does anything under real
 * concurrency, or that a real 23505 gets mapped to ConcurrencyError. Skips
 * cleanly (not fails) without DATABASE_URL — see docker-compose.yml's
 * `overengineered` profile and CI's `verify` job.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const created: DomainEvent = {
  type: 'TeamCreated',
  teamId: 't1',
  name: 'T',
  at: '2026-01-01T00:00:00.000Z',
};
const joined: DomainEvent = {
  type: 'MemberJoined',
  memberId: 'm1',
  name: 'Anna',
  at: '2026-01-01T00:00:01.000Z',
};

/** Drops the schema so each test opens against a genuinely fresh database. */
async function resetSchema(): Promise<void> {
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await admin.query('DROP TABLE IF EXISTS events, schema_migrations');
  } finally {
    await admin.end();
  }
}

describe.skipIf(!DATABASE_URL)('postgresEventStore (requires DATABASE_URL)', () => {
  it('applies migrations on a fresh database and records them', async () => {
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      expect(await store.appliedMigrations()).toEqual(['001_events']);
    } finally {
      await store.close();
    }
  });

  it('reopening an already-migrated database is idempotent', async () => {
    await resetSchema();
    const first = await openPostgresEventStore(DATABASE_URL);
    await first.append('t1', 0, [created]);
    await first.close();

    const second = await openPostgresEventStore(DATABASE_URL);
    try {
      expect(await second.appliedMigrations()).toEqual(['001_events']);
      expect(await second.load('t1')).toHaveLength(1);
    } finally {
      await second.close();
    }
  });

  it('two instances booting concurrently against a fresh database both migrate safely', async () => {
    // This is exactly the race the pg_advisory_lock in migrate() guards
    // against: two server instances starting at once, each racing to run
    // `CREATE TABLE events`. Without the lock this throws (or double-applies).
    await resetSchema();
    const [a, b] = await Promise.all([
      openPostgresEventStore(DATABASE_URL),
      openPostgresEventStore(DATABASE_URL),
    ]);
    try {
      expect(await a.appliedMigrations()).toEqual(['001_events']);
      expect(await b.appliedMigrations()).toEqual(['001_events']);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it('appends and loads a stream in order with versions and positions', async () => {
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      await store.append('t1', 0, [created, joined]);
      const events = await store.load('t1');
      expect(events.map((e) => [e.type, e.version])).toEqual([
        ['TeamCreated', 1],
        ['MemberJoined', 2],
      ]);
      expect(events[1]).toMatchObject({
        memberId: 'm1',
        name: 'Anna',
        streamId: 't1',
        position: 2,
      });
    } finally {
      await store.close();
    }
  });

  it('rejects a stale expectedVersion (gapless-version constraint)', async () => {
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      await store.append('t1', 0, [created]);
      await expect(store.append('t1', 0, [joined])).rejects.toThrow(ConcurrencyError);
      await expect(store.append('t1', 5, [joined])).rejects.toThrow(ConcurrencyError);
      expect(await store.load('t1')).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  it('a batch is all-or-nothing when a later event collides', async () => {
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      await store.append('t1', 0, [created]);
      await expect(
        store.append('t1', 1, [
          { ...joined, memberId: 'x' },
          { ...joined, memberId: 'y' },
        ]),
      ).resolves.toHaveLength(2);
      await expect(
        store.append('t1', 2, [
          { ...joined, memberId: 'x2' },
          { ...joined, memberId: 'y2' },
        ]),
      ).rejects.toThrow(ConcurrencyError);
      expect((await store.load('t1')).map((e) => e.version)).toEqual([1, 2, 3]);
    } finally {
      await store.close();
    }
  });

  it('maps a genuine 23505 duplicate-key race to ConcurrencyError', async () => {
    // Two transactions both read current version 0 before either commits,
    // so the in-transaction version check can't catch the race — only the
    // UNIQUE(stream_id, version) constraint firing as Postgres error 23505
    // (caught in append()'s catch block) can. Racing many concurrent
    // appends at the same expectedVersion forces that overlap instead of
    // relying on timing luck between two — but only once the pool's
    // connections already exist: an attempt still waiting on
    // pool.connect()'s TCP handshake loses the race to one already running,
    // which just re-triggers the (already-covered) pre-check path instead.
    // Warming the pool with one append per attempt first, on disjoint
    // streams, forces the race to land on the INSERT itself.
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      const concurrency = 8;
      await Promise.all(
        Array.from({ length: concurrency }, (_, i) =>
          store.append(`warmup-${i}`, 0, [{ ...created, teamId: `warmup-${i}` }]),
        ),
      );
      const attempts = Array.from({ length: concurrency }, (_, i) =>
        store.append('t1', 0, [{ ...created, teamId: `race-${i}` }]),
      );
      const results = await Promise.allSettled(attempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected.length).toBeGreaterThan(0);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyError);
      }
      expect(await store.load('t1')).toHaveLength(1);
    } finally {
      await store.close();
    }
  });

  it('streamsWithEvent orders by first occurrence, matching the SQLite adapter', async () => {
    await resetSchema();
    const store = await openPostgresEventStore(DATABASE_URL);
    try {
      await store.append('t2', 0, [{ ...created, teamId: 't2' }]);
      await store.append('t1', 0, [created]);
      await store.append('t2', 1, [joined]);
      expect(await store.streamsWithEvent('TeamCreated')).toEqual(['t2', 't1']);
    } finally {
      await store.close();
    }
  });

  it('replays a multi-event stream faithfully after reopening the store', async () => {
    await resetSchema();
    const first = await openPostgresEventStore(DATABASE_URL);
    await first.append('t1', 0, [
      created,
      joined,
      { ...joined, memberId: 'm2', name: 'Ben', at: '2026-01-01T00:00:02.000Z' },
    ]);
    await first.close();

    const second = await openPostgresEventStore(DATABASE_URL);
    try {
      const events = await second.load('t1');
      expect(events.map((e) => e.type)).toEqual(['TeamCreated', 'MemberJoined', 'MemberJoined']);
      expect(events.map((e) => e.version)).toEqual([1, 2, 3]);
      expect(events[0]).toMatchObject({ teamId: 't1', name: 'T' });
      expect(events[2]).toMatchObject({ memberId: 'm2', name: 'Ben' });
    } finally {
      await second.close();
    }
  });
});
