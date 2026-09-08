import { mkdtemp, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientIp, createAuth } from './auth.ts';
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

/**
 * Opens a raw socket, writes the request headers (with a correct
 * Content-Length) immediately, then writes the body only after
 * `bodyDelayMs`. `fetch()` sends headers and body back-to-back in one go, so
 * with `fetch` the whole request — including the `await readJson(req)` on
 * the server — resolves before the next connection is even accepted,
 * leaving no real concurrency window. Splitting header and body writes with
 * a real gap forces N connections to be mid-`readJson` at the same time, the
 * way an actual burst of slow/slow-to-send clients would be.
 */
function rawLoginRequest(
  port: number,
  body: string,
  bodyDelayMs: number,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(
        `POST /api/auth/login HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Content-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n\r\n`,
      );
      setTimeout(() => socket.write(body), bodyDelayMs);
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
      const statusLine = data.split('\r\n')[0];
      const match = statusLine?.match(/^HTTP\/1\.\d (\d{3})/);
      if (match?.[1]) {
        resolve({ status: Number(match[1]) });
        socket.end();
      }
    });
    socket.on('error', reject);
  });
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

describe('clientIp / TRUST_PROXY gating', () => {
  function fakeReq(headers: Record<string, string>, remoteAddress = '10.0.0.9'): IncomingMessage {
    return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
  }

  it('ignores x-forwarded-for unless SCHULDRAD_TRUST_PROXY=1', () => {
    const req = fakeReq({ 'x-forwarded-for': '1.2.3.4' });
    expect(clientIp(req, {})).toBe('10.0.0.9');
    expect(clientIp(req, { SCHULDRAD_TRUST_PROXY: '1' })).toBe('1.2.3.4');
  });

  it('Secure cookie flag follows x-forwarded-proto only when TRUST_PROXY is set', () => {
    const auth = createAuth({ SCHULDRAD_PASSWORD: 'geheim' });
    const trustedAuth = createAuth({
      SCHULDRAD_PASSWORD: 'geheim',
      SCHULDRAD_TRUST_PROXY: '1',
    });
    const httpsReq = fakeReq({ 'x-forwarded-proto': 'https' });

    expect(auth.secureCookie(httpsReq)).toBe(false);
    expect(trustedAuth.secureCookie(httpsReq)).toBe(true);
    expect(trustedAuth.secureCookie(fakeReq({ 'x-forwarded-proto': 'http' }))).toBe(false);
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

  it('rate limit holds under concurrent requests (check-then-record is not racy)', async () => {
    const port = (ctx.http.server.address() as AddressInfo).port;
    const body = JSON.stringify({ password: 'nope' });
    // All 10 connections send their headers up front, then (after a real
    // 100ms gap) their bodies, so the server has 10 requests genuinely
    // in-flight through `await readJson(req)` at once.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () => rawLoginRequest(port, body, 100)),
    );
    const nonLimited = attempts.filter((r) => r.status !== 429);
    expect(nonLimited.length).toBe(5);
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

  it('a session dies at the absolute cap even when touched repeatedly before the sliding TTL', async () => {
    // ttlMs is deliberately huge so the sliding expiry never fires early -
    // only the absolute cap should be able to end this session.
    const capped = boot(
      createAuth({ SCHULDRAD_PASSWORD: 'geheim' }, { ttlMs: 60_000, absoluteTtlMs: 200 }),
    );
    await new Promise<void>((r) => capped.http.server.listen(0, '127.0.0.1', r));
    const cappedBase = `http://127.0.0.1:${(capped.http.server.address() as AddressInfo).port}`;
    try {
      const login = await fetch(`${cappedBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'geheim' }),
      });
      const cookie = cookiePair(login);
      for (let i = 0; i < 4; i++) {
        expect((await fetch(`${cappedBase}/api/teams`, { headers: { cookie } })).status).toBe(200);
        await new Promise((r) => setTimeout(r, 15));
      }
      await new Promise((r) => setTimeout(r, 250));
      expect((await fetch(`${cappedBase}/api/teams`, { headers: { cookie } })).status).toBe(401);
    } finally {
      await new Promise<void>((r) => capped.http.server.close(() => r()));
      capped.store.close();
    }
  });

  it('logging out closes an open SSE stream for that session', async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'geheim' }),
    });
    const cookie = cookiePair(login);
    const team = await (
      await fetch(`${base}/api/teams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Team' }),
      })
    ).json();

    const sse = await fetch(`${base}/api/teams/${team.teamId}/events`, { headers: { cookie } });
    const reader = sse.body?.getReader();
    if (!reader) throw new Error('no body');
    await reader.read(); // ": connected" comment, confirms the stream is open

    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    });

    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it('does not open an SSE stream for a session that logged out while the team load was in flight', async () => {
    // Own store/commands (not `boot()`'s) so we can wrap `loadTeam` and
    // control exactly when it resolves — the injected `commands` param is
    // how http.ts is testable here without touching the real event store's
    // timing.
    const store = openEventStore(':memory:');
    const realCommands = createCommands(store);
    const raceAuth = createAuth({ SCHULDRAD_PASSWORD: 'geheim' });
    let releaseLoad!: () => void;
    let enteredLoad!: () => void;
    const loadGate = new Promise<void>((r) => (releaseLoad = r));
    const enteredLoadTeam = new Promise<void>((r) => (enteredLoad = r));
    const commands = {
      ...realCommands,
      async loadTeam(teamId: string) {
        enteredLoad();
        await loadGate;
        return realCommands.loadTeam(teamId);
      },
    };
    const http = createHttpServer(commands, null, raceAuth);
    await new Promise<void>((r) => http.server.listen(0, '127.0.0.1', r));
    const raceBase = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`;
    try {
      const login = await fetch(`${raceBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'geheim' }),
      });
      const cookie = cookiePair(login);
      const team = await realCommands.createTeam('Team');

      const ssePromise = fetch(`${raceBase}/api/teams/${team.teamId}/events`, {
        headers: { cookie },
      });
      // The handler is now blocked inside commands.loadTeam. Log out during
      // that window, then let loadTeam resolve.
      await enteredLoadTeam;
      const logout = await fetch(`${raceBase}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
      });
      expect(logout.status).toBe(204);
      releaseLoad();

      const sse = await ssePromise;
      // Read (or cancel) the body no matter the outcome: a still-open SSE
      // stream keeps its socket alive, which would otherwise stall
      // `server.close()` below until the test times out.
      await sse.body?.cancel().catch(() => {});
      expect(sse.status).toBe(401);
    } finally {
      await new Promise<void>((r) => http.server.close(() => r()));
      store.close();
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
