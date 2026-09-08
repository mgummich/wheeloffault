import { apiFetch } from './apiFetch.ts';
import type { AuthState } from './authState.ts';

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  apiFetch(`/api/auth${path}`, method, body);

export type LoginResult = { ok: true } | { ok: false; status: number };

/** Thin client for the auth endpoints (server mode only). Never used by sessionApi/static mode. */
export const authApi = {
  status: async (): Promise<AuthState> => {
    const res = await call('GET', '/status');
    return (await res.json()) as AuthState;
  },
  login: async (password: string): Promise<LoginResult> => {
    const res = await call('POST', '/login', { password });
    return res.ok ? { ok: true } : { ok: false, status: res.status };
  },
  logout: (): Promise<Response> => call('POST', '/logout'),
};
