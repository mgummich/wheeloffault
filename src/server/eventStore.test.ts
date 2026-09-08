import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../domain/events.ts';
import { ConcurrencyError, openEventStore } from './eventStore.ts';

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

describe('eventStore', () => {
  it('loads an empty stream as []', async () => {
    const store = openEventStore(':memory:');
    try {
      await expect(store.load('t1')).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it('appends and loads a stream in order with versions and positions', async () => {
    const store = openEventStore(':memory:');
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
      store.close();
    }
  });

  it('rejects a stale expectedVersion', async () => {
    const store = openEventStore(':memory:');
    try {
      await store.append('t1', 0, [created]);
      await expect(store.append('t1', 0, [joined, joined])).rejects.toThrow(ConcurrencyError);
      await expect(store.append('t1', 2, [joined])).rejects.toThrow(ConcurrencyError);
      expect(await store.load('t1')).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('a batch is all-or-nothing when a later event collides', async () => {
    const store = openEventStore(':memory:');
    try {
      await store.append('t1', 0, [created]);
      // Version 2 is free, version 3 is not: the whole batch must be rolled back.
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
      store.close();
    }
  });

  it('isolates streams', async () => {
    const store = openEventStore(':memory:');
    try {
      await store.append('t1', 0, [created]);
      await store.append('t2', 0, [{ ...created, teamId: 't2' }]);
      expect(await store.load('t2')).toHaveLength(1);
      expect(await store.streamsWithEvent('TeamCreated')).toEqual(['t1', 't2']);
    } finally {
      store.close();
    }
  });

  it('migrations are recorded once and reopening the same file is idempotent', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'schuldrad-')), 'test.db');
    const first = openEventStore(file);
    await first.append('t1', 0, [created]);
    expect(await first.appliedMigrations()).toEqual(['001_events']);
    first.close();
    const second = openEventStore(file);
    expect(await second.appliedMigrations()).toEqual(['001_events']);
    expect(await second.load('t1')).toHaveLength(1);
    second.close();
    rmSync(dirname(file), { recursive: true, force: true });
  });
});
