import { describe, expect, it } from 'vitest';
import { migrations } from './migrations.ts';
import { toPostgresMigration } from './postgresEventStore.ts';

describe('toPostgresMigration', () => {
  it('ports the initial migration to Postgres syntax', () => {
    const [initial] = migrations;
    if (!initial) throw new Error('unreachable: migrations is non-empty');
    const ported = toPostgresMigration(initial.sql);
    expect(ported).toContain('BIGSERIAL PRIMARY KEY');
    expect(ported).toContain('JSONB   NOT NULL');
    expect(ported).not.toMatch(/AUTOINCREMENT/);
  });

  it('passes through SQL that needs no porting, e.g. ADD COLUMN', () => {
    const sql = 'ALTER TABLE events ADD COLUMN whatever TEXT;';
    expect(toPostgresMigration(sql)).toBe(sql);
  });

  it('throws on an unported SQLite-ism', () => {
    const sql = 'ALTER TABLE events ADD COLUMN id INTEGER PRIMARY KEY AUTOINCREMENT;';
    expect(() => toPostgresMigration(sql)).toThrow(/unported SQLite-ism/);
  });
});
