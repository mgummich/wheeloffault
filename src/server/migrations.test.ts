import { describe, expect, it } from 'vitest';
import { migrations } from './migrations.ts';

/**
 * Collapses each dialect's only intentional differences (the primary-key
 * declaration and the payload column's type) to a shared token, plus
 * whitespace, so a straight string comparison catches everything else a
 * migration author might let drift between `sql` and `pgSql`: column names,
 * column order, NOT NULL, the UNIQUE constraint, and index names/targets.
 */
function normalize(ddl: string): string {
  return ddl
    .replace(/INTEGER\s+PRIMARY KEY\s+AUTOINCREMENT/gi, 'PK')
    .replace(/BIGSERIAL\s+PRIMARY KEY/gi, 'PK')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('migrations', () => {
  for (const m of migrations) {
    it(`${m.id}: sql and pgSql declare the same column/constraint/index identifiers`, () => {
      expect(normalize(m.pgSql)).toBe(normalize(m.sql));
    });
  }
});
