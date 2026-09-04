import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openConfiguredEventStore } from './store.ts';

describe('openConfiguredEventStore', () => {
  it('uses sqlite by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'schuldrad-store-'));
    const store = await openConfiguredEventStore({}, dir);
    try {
      expect(await store.appliedMigrations()).toEqual(['001_events']);
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires DATABASE_URL for postgres', async () => {
    await expect(openConfiguredEventStore({ EVENT_STORE: 'postgres' }, 'data')).rejects.toThrow(
      'DATABASE_URL',
    );
  });

  it('rejects unknown event stores', async () => {
    await expect(openConfiguredEventStore({ EVENT_STORE: 'mysql' }, 'data')).rejects.toThrow(
      'EVENT_STORE',
    );
  });
});
