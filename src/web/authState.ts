import { useSyncExternalStore } from 'react';

/**
 * Tiny external store (same pattern as i18n/index.ts) tracking whether
 * server-mode auth is enabled and whether this browser is currently
 * authenticated. Populated by GET /api/auth/status at startup and kept in
 * sync by serverApi.ts (a 401 flips it back to unauthenticated) and by
 * successful login/logout.
 */
export interface AuthState {
  enabled: boolean;
  authenticated: boolean;
}

let state: AuthState = { enabled: false, authenticated: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getAuthState(): AuthState {
  return state;
}

export function setAuthStatus(next: AuthState): void {
  state = next;
  emit();
}

export function markAuthenticated(): void {
  state = { ...state, authenticated: true };
  emit();
}

/** Called on a 401 from the API: only meaningful once we know auth is enabled. */
export function markUnauthenticated(): void {
  if (!state.authenticated) return;
  state = { ...state, authenticated: false };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(subscribe, getAuthState);
}
