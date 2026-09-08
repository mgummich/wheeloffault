import { useSyncExternalStore } from 'react';
import { de } from './de.ts';
import { en } from './en.ts';
import type { Lang, MessageKey } from './messages.ts';

export type { Lang, MessageKey };

const dict: Record<Lang, Record<MessageKey, string>> = { en, de };
const STORAGE_KEY = 'schuldrad.lang';

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // ignore (private mode, disabled storage)
  }
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

// Read synchronously at module init, before first render: no flash of the
// wrong language.
let lang: Lang = detectLang();
const listeners = new Set<() => void>();

function applyDocumentLang() {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
applyDocumentLang();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  applyDocumentLang();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Simple `{param}` interpolation. No ICU, no plural engine — use explicit
 * `.one`/`.many` keys for plurals. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dict[lang][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Subscribes the component to language changes and returns the current
 * language plus `t`. Components must call `t` during render (not cache it)
 * so they re-render with fresh strings on language change. */
export function useI18n(): { lang: Lang; t: typeof t; setLang: typeof setLang } {
  const current = useSyncExternalStore(subscribe, getLang);
  return { lang: current, t, setLang };
}
