/**
 * Shared fetch preamble for both serverApi and authApi: the server requires
 * application/json on every state-changing request (CSRF defense), so send
 * it — and a body to match — even when there's nothing to say.
 */
export function apiFetch(url: string, method: string, body?: unknown): Promise<Response> {
  const hasBody = method !== 'GET';
  return fetch(url, {
    method,
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}
