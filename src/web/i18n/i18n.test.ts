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
  it('returns the plain message when there are no params', () => {
    expect(t('common.save')).toBe(en['common.save']);
  });

  it('interpolates {param} placeholders', () => {
    expect(t('home.memberCount', { n: 5 })).toBe('5 active');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(t('common.save', { unused: 1 })).toBe(en['common.save']);
  });
});
