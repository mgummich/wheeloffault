import { describe, expect, it } from 'vitest';
import { str, strArray } from './validate.ts';

describe('str', () => {
  it('accepts an ordinary string', () => {
    expect(str({ name: 'Anna' }, 'name')).toBe('Anna');
  });

  it('rejects a NUL byte (SQLite TEXT accepts it, Postgres jsonb does not)', () => {
    expect(() => str({ name: 'Ann\u0000a' }, 'name')).toThrow();
  });

  it('rejects a string over the max length', () => {
    expect(() => str({ name: 'x'.repeat(101) }, 'name', 100)).toThrow();
  });
});

describe('strArray', () => {
  it('accepts an ordinary list of strings', () => {
    expect(strArray({ names: ['Anna', 'Bob'] }, 'names')).toEqual(['Anna', 'Bob']);
  });

  it('rejects an item containing a NUL byte, same as str (SQLite TEXT accepts it, Postgres jsonb does not)', () => {
    expect(() => strArray({ names: ['Ann\u0000a'] }, 'names')).toThrow();
  });

  it('rejects an item over the per-item max length, same as str', () => {
    expect(() => strArray({ names: ['x'.repeat(101)] }, 'names', 500, 100)).toThrow();
  });

  it('rejects more items than maxItems', () => {
    expect(() => strArray({ names: ['a', 'b', 'c'] }, 'names', 2)).toThrow();
  });
});
