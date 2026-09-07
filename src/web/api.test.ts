import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('API mode', () => {
  it('uses the server API when built for server mode', async () => {
    vi.stubEnv('VITE_API_MODE', 'server');
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ teamId: 'server-team' })));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('sessionStorage', undefined);
    const { api } = await import('./api.ts');
    expect(await api.createTeam('Shared')).toEqual({ teamId: 'server-team' });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Shared' }),
      }),
    );
  });

  it('keeps static builds local without contacting a server', async () => {
    vi.stubEnv('VITE_API_MODE', '');
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./api.ts');
    const team = await api.createTeam('Local');
    expect((await api.getTeam(team.teamId)).name).toBe('Local');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
