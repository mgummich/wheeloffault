import type { en } from './en.ts';

/** Every valid translation key, derived from en.ts. A typo or a key missing
 * from a dictionary is a compile error, not a runtime fallback. */
export type MessageKey = keyof typeof en;
export type Lang = 'en' | 'de';
