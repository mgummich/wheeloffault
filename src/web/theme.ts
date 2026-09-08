import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'schuldrad.theme';

function detectTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'system' || stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore (private mode, disabled storage)
  }
  return 'system';
}

// Read synchronously at module init, before first render: the index.html
// inline script already set the DOM attribute to avoid a flash, this just
// syncs the in-memory value with it.
let theme: Theme = detectTheme();
const listeners = new Set<() => void>();

function applyDocumentTheme() {
  if (typeof document === 'undefined') return;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
applyDocumentTheme();

function getTheme(): Theme {
  return theme;
}

export function setTheme(next: Theme): void {
  if (next === theme) return;
  theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  applyDocumentTheme();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribes the component to theme changes. */
export function useTheme(): { theme: Theme; setTheme: typeof setTheme } {
  const current = useSyncExternalStore(subscribe, getTheme);
  return { theme: current, setTheme };
}
