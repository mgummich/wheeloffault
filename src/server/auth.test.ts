import { mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth } from './auth.ts';
import { createCommands } from './commands.ts';
import { openEventStore } from './eventStore.ts';
import { createHttpServer } from './http.ts';

function boot(auth = createAuth({ SCHULDRAD_PASSWORD: 'geheim' })) {
  const store = openEventStore(':memory:');
  const commands = createCommands(store);
  const http = createHttpServer(commands, null, auth);
  return { store, http, auth };
}

let ctx: ReturnType<typeof boot>;
let base: string;

beforeEach(async () => {
  ctx = boot();
  await new Promise<void>((r) => ctx.http.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(ctx.http.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => ctx.http.server.close(() => r()));
  ctx.store.close();
});

/** Extracts the session cookie's "name=value" pair from a Set-Cookie header (attributes stripped). */
function cookiePair(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error('no set-cookie header');
  return raw.split(';')[0] ?? '';
}

describe('auth disabled (default)', () => {
  it('existing behaviour is untouched: no cookie needed, status reports disabled', async () => {
    const disabled = boot(createAuth({}));
    await new Promise<void>((r) => disabled.http.server.listen(0, '127.0.0.1', r));
    const disabledBase = `http://127.0.0.1:${(disabled.http.server.address() as AddressInfo).port}`;
    try {
      const status = await fetch(`${disabledBase}/api/auth/status`);
      expect(await status.json()).toEqual({ enabled: false, authenticated: false });
      expect((await fetch(`${disabledBase}/api/teams`)).status).toBe(200);
      expect((await fetch(`${disabledBase}/api/health`)).status).toBe(200);
    } finally {
      await new Promise<void>((r) => disabled.http.server.close(() => r()));
      disabled.store.close();
    }
  });
});

describe('auth enabled', () => {
  it('status reports enabled + unauthenticated before login', async () => {
    const res = await fetch(`${base}/api/auth/status`);
    expect(await res.json()).toEqual({ enabled: true, authenticated: false });
  });

  it('protects a normal API route and health/auth stay open', async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/auth/status`)).status).toBe(200);
    expect((await fetch(`${base}/api/teams`)).status).toBe(401);
    const body = await (await fetch(`${base}/api/teams`)).json();
    expect(body).toEqual({ error: 'Authentication required', code: 'unauthorized' });
  });

  it('rejects a wrong password, accepts the right one, and then unlocks protected routes', async () => {
    const wrong = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();

    const right = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'geheim' }),
    });
    expect(right.status).toBe(204);
    const cookie = cookiePair(right);
    expect(cookie).toMatch(/^schuldrad_session=/);
    expect(right.headers.get('set-cookie')).toContain('HttpOnly');
    expect(right.headers.get('set-cookie')).toContain('SameSite=Strict');
    expect(right.headers.get('set-cookie')).toContain('Path=/');

    const teams = await fetch(`${base}/api/teams`, { headers: { cookie } });
    expect(teams.status).toBe(200);

    const status = await fetch(`${base}/api/auth/status`, { headers: { cookie } });
    expect(await status.json()).toEqual({ enabled: true, authenticated: true });
  });

  it('sets Secure when SCHULDRAD_SECURE_COOKIES=1', async () => {
    const secure = boot(
      createAuth({ SCHULDRAD_PASSWORD: 'geheim', SCHULDRAD_SECURE_COOKIES: '1' }),
    );
    await new Promise<void>((r) => secure.http.server.listen(0, '127.0.0.1', r));
    const secureBase = `http://127.0.0.1:${(secure.http.server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${secureBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'geheim' }),
      });
      expect(res.headers.get('set-cookie')).toContain('Secure');
    } finally {
      await new Promise<void>((r) => secure.http.server.close(() => r()));
      secure.store.close();
    }
  });

  it('rate-limits after 5 failed attempts per IP with Retry-After', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'nope' }),
      });
      expect(res.status).toBe(401);
    }
    const limited = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' }),
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Even the correct password is refused while rate-limited.
    const stillLimited = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'geheim' }),
    });
    expect(stillLimited.status).toBe(429);
  });

  it('SSE requires a session too', async () => {
    const team = await (
      await fetch(`${base}/api/teams`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookiePair(
            await fetch(`${base}/api/auth/login`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ password: 'geheim' }),
            }),
          ),
        },
        body: JSON.stringify({ name: 'Team' }),
      })
    ).json();

    const unauth = await fetch(`${base}/api/teams/${team.teamId}/events`);
    expect(unauth.status).toBe(401);
  });

  it('logout destroys the session and clears the cookie', async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'geheim' }),
    });
    const cookie = cookiePair(login);

    const logout = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await fetch(`${base}/api/teams`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });

  it('a session expires after its TTL', async () => {
    const shortLived = boot(createAuth({ SCHULDRAD_PASSWORD: 'geheim' }, { ttlMs: 20 }));
    await new Promise<void>((r) => shortLived.http.server.listen(0, '127.0.0.1', r));
    const shortBase = `http://127.0.0.1:${(shortLived.http.server.address() as AddressInfo).port}`;
    try {
      const login = await fetch(`${shortBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'geheim' }),
      });
      const cookie = cookiePair(login);
      expect((await fetch(`${shortBase}/api/teams`, { headers: { cookie } })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      expect((await fetch(`${shortBase}/api/teams`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await new Promise<void>((r) => shortLived.http.server.close(() => r()));
      shortLived.store.close();
    }
  });

  it('reads the password from SCHULDRAD_PASSWORD_FILE, trimming a trailing newline, file wins over env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'schuldrad-secret-'));
    const file = join(dir, 'password');
    await writeFile(file, 'from-file\n');
    const fileAuth = createAuth({
      SCHULDRAD_PASSWORD: 'from-env',
      SCHULDRAD_PASSWORD_FILE: file,
    });
    expect(await fileAuth.verify('from-file')).toBe(true);
    expect(await fileAuth.verify('from-env')).toBe(false);
  });
});
