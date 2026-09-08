import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(listener: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', listener);
  return () => mql.removeEventListener('change', listener);
}

function getSnapshot(): boolean {
  return window.matchMedia(query).matches;
}

/** Tracks the OS reduced-motion setting live, so a mid-session toggle applies without a remount. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
