import type { AuthState } from './authState.ts';

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  // The server requires application/json on every state-changing request (CSRF
  // defense), so send it — and a body to match — even when there's nothing to say.
  const hasBody = method !== 'GET';
  return fetch(`/api/auth${path}`, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

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
