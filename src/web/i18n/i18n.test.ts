import { describe, expect, it } from 'vitest';
import { de } from './de.ts';
import { en } from './en.ts';
import { t } from './index.ts';

describe('translation dictionaries', () => {
  it('en and de have exactly the same keys', () => {
    expect(new Set(Object.keys(de))).toEqual(new Set(Object.keys(en)));
  });
});

describe('t()', () => {
  it('substitutes a {param} placeholder', () => {
    expect(t('home.memberCount', { n: 5 })).toBe('5 active');
  });

  it('leaves an unfilled {param} placeholder in place', () => {
    expect(t('home.memberCount', {})).toBe('{n} active');
  });
});
