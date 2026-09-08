import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '../domain/events.ts';
import { verifySpin } from '../domain/fairness/draw.ts';
import type { MemberReport } from '../domain/projections/report.ts';
import { createCommands } from './commands.ts';
import { openEventStore } from './eventStore.ts';
import { createHttpServer } from './http.ts';
import type { SpinView, TeamView } from '../domain/views.ts';

/** Boots the real HTTP server on an in-memory store; tests talk plain HTTP. */
function boot() {
  const store = openEventStore(':memory:');
  let broadcast: (teamId: string, events: StoredEvent[]) => void = () => {};
  const commands = createCommands(store, (t, e) => broadcast(t, e));
  const http = createHttpServer(commands, null);
  broadcast = http.broadcast;
  return { store, http };
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

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function teamWith(names: string[]): Promise<TeamView> {
  const created = await call<TeamView>('POST', '/api/teams', { name: 'Team Fahrplan' });
  expect(created.status).toBe(201);
  const withMembers = await call<TeamView>('POST', `/api/teams/${created.body.teamId}/members`, {
    names,
  });
  expect(withMembers.status).toBe(200);
  return withMembers.body;
}

async function fullSpin(teamId: string, spinId = crypto.randomUUID(), clientSeed = 'e2e') {
  const commit = await call<SpinView>('POST', `/api/teams/${teamId}/spins`, { spinId });
  expect(commit.status).toBe(201);
  const reveal = await call<SpinView>('POST', `/api/teams/${teamId}/spins/${spinId}/reveal`, {
    clientSeed,
  });
  expect(reveal.status).toBe(200);
  return { commit: commit.body, reveal: reveal.body };
}

describe('API', () => {
  it('returns 400 for a malformed absolute request URL and remains available', async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect((ctx.http.server.address() as AddressInfo).port, '127.0.0.1');
      let response = '';
      socket.setTimeout(1000, () => socket.destroy(new Error('request timed out')));
      socket.on('error', reject);
      socket.on('connect', () =>
        socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'),
      );
      socket.on('data', (chunk) => {
        response += chunk.toString();
      });
      socket.on('end', () => resolve(response));
    });
    expect(response).toContain('HTTP/1.1 400');
    expect((await call('GET', '/api/health')).status).toBe(200);
  });

  it('creates a team, adds members (deduplicated), deactivates, spins, reveals, reports', async () => {
    const team = await teamWith(['Anna', 'Bob', ' anna ', 'Cem']);
    expect(team.members.map((m) => m.name)).toEqual(['Anna', 'Bob', 'Cem']);
    const bob = team.members[1];
    if (!bob) throw new Error('no bob');
    const deactivated = await call<TeamView>(
      'POST',
      `/api/teams/${team.teamId}/members/${bob.memberId}/deactivate`,
    );
    expect(deactivated.body.members[1]?.active).toBe(false);

    const { commit, reveal } = await fullSpin(team.teamId);
    expect(commit.reveal).toBeNull();
    expect(commit.participants.map((p) => p.memberId)).not.toContain(bob.memberId);
    expect(JSON.stringify(commit)).not.toContain('serverSeed');
    expect(reveal.reveal?.selectedMemberId).toBeDefined();
    expect(reveal.reveal?.selectedMemberId).not.toBe(bob.memberId);

    const proof = {
      nonce: reveal.nonce,
      commitment: reveal.commitment,
      participants: reveal.participants,
      ...(reveal.reveal ?? { serverSeed: '', clientSeed: '', digest: '', selectedMemberId: '' }),
    };
    expect((await verifySpin(proof)).ok).toBe(true);

    const view = await call<TeamView>('GET', `/api/teams/${team.teamId}`);
    expect(view.body.statistics.totalSpins).toBe(1);
    expect(view.body.pendingSpin).toBeNull();
    const winner = reveal.reveal?.selectedMemberId ?? '';
    const report = await call<MemberReport>(
      'GET',
      `/api/teams/${team.teamId}/members/${winner}/report`,
    );
    expect(report.body.totalSelections).toBe(1);
    expect(report.body.achievements.map((a) => a.id)).toContain('erste-fahrt');
    expect(view.body.statistics.hallOfShame[0]?.memberId).toBe(winner);
  });

  it('a retried commit never creates a second spin; a second concurrent spin is refused', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const spinId = crypto.randomUUID();
    const [a, b] = await Promise.all([
      call<SpinView>('POST', `/api/teams/${team.teamId}/spins`, { spinId }),
      call<SpinView>('POST', `/api/teams/${team.teamId}/spins`, { spinId }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.commitment).toBe(b.body.commitment);
    const other = await call<{ error: string; spinId: string }>(
      'POST',
      `/api/teams/${team.teamId}/spins`,
      { spinId: 'other' },
    );
    expect(other.status).toBe(409);
    expect(other.body.spinId).toBe(spinId);
    const view = await call<TeamView>('GET', `/api/teams/${team.teamId}`);
    expect(view.body.spins).toHaveLength(1);
    expect(view.body.pendingSpin?.spinId).toBe(spinId);
    // The secret must not leak anywhere in the team view while the spin is pending.
    expect(JSON.stringify(view.body)).not.toContain('serverSeed');
  });

  it('a pending spin survives a server restart and can be revealed from the persisted commit', async () => {
    const team = await teamWith(['Anna', 'Bob', 'Cem']);
    const spinId = crypto.randomUUID();
    const commit = await call<SpinView>('POST', `/api/teams/${team.teamId}/spins`, { spinId });
    expect(commit.status).toBe(201);

    // "Restart": a fresh command layer + HTTP server over the same database.
    const restarted = createHttpServer(createCommands(ctx.store), null);
    await new Promise<void>((r) => restarted.server.listen(0, '127.0.0.1', r));
    const port = (restarted.server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/teams/${team.teamId}`);
      const view = (await res.json()) as TeamView;
      expect(view.pendingSpin?.spinId).toBe(spinId);
      const reveal = await fetch(
        `http://127.0.0.1:${port}/api/teams/${team.teamId}/spins/${spinId}/reveal`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientSeed: 'after-restart' }),
        },
      );
      expect(reveal.status).toBe(200);
      const spin = (await reveal.json()) as SpinView;
      expect(spin.commitment).toBe(commit.body.commitment);
      if (!spin.reveal) throw new Error('no reveal');
      expect(
        (
          await verifySpin({
            nonce: spin.nonce,
            commitment: spin.commitment,
            participants: spin.participants,
            ...spin.reveal,
          })
        ).ok,
      ).toBe(true);
    } finally {
      await new Promise<void>((r) => restarted.server.close(() => r()));
    }
  });

  it('reveal is idempotent for the same client seed and refuses another', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const spinId = crypto.randomUUID();
    await call('POST', `/api/teams/${team.teamId}/spins`, { spinId });
    const [r1, r2] = await Promise.all([
      call<SpinView>('POST', `/api/teams/${team.teamId}/spins/${spinId}/reveal`, {
        clientSeed: 'x',
      }),
      call<SpinView>('POST', `/api/teams/${team.teamId}/spins/${spinId}/reveal`, {
        clientSeed: 'x',
      }),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r1.body.reveal).toEqual(r2.body.reveal);
    const r3 = await call('POST', `/api/teams/${team.teamId}/spins/${spinId}/reveal`, {
      clientSeed: 'y',
    });
    expect(r3.status).toBe(409);
  });

  it('concurrent member additions all land (optimistic retry)', async () => {
    const team = await teamWith([]);
    await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((n) =>
        call('POST', `/api/teams/${team.teamId}/members`, { name: n }),
      ),
    );
    const view = await call<TeamView>('GET', `/api/teams/${team.teamId}`);
    expect(view.body.members.map((m) => m.name).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('appeals: upheld appeal removes the selection from the statistics', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const { reveal } = await fullSpin(team.teamId);
    const appealed = await call<TeamView>(
      'POST',
      `/api/teams/${team.teamId}/spins/${reveal.spinId}/appeal`,
      { reason: 'War im Urlaub' },
    );
    expect(appealed.body.statistics.openAppeals).toBe(1);
    const upheld = await call<TeamView>(
      'POST',
      `/api/teams/${team.teamId}/spins/${reveal.spinId}/appeal/uphold`,
    );
    expect(upheld.body.statistics.officialSpins).toBe(0);
    expect(upheld.body.statistics.overturnedSpins).toBe(1);
    const again = await call(
      'POST',
      `/api/teams/${team.teamId}/spins/${reveal.spinId}/appeal/reject`,
    );
    expect(again.status).toBe(409);
  });

  it('policy: immunity is visible in the commit and consumed', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const anna = team.members[0]?.memberId ?? '';
    const bob = team.members[1]?.memberId ?? '';
    await call('POST', `/api/teams/${team.teamId}/members/${anna}/immunity`, {
      reason: 'Fahrgastrecht',
    });
    const { commit, reveal } = await fullSpin(team.teamId);
    expect(commit.participants).toEqual(
      [
        { memberId: anna, weight: 0 },
        { memberId: bob, weight: 1000 },
      ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
    );
    expect(reveal.reveal?.selectedMemberId).toBe(bob);
    const view = await call<TeamView>('GET', `/api/teams/${team.teamId}`);
    expect(view.body.immunities).toEqual([]);
  });

  it('immunity can be revoked before it is consumed', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const anna = team.members[0]?.memberId ?? '';
    await call('POST', `/api/teams/${team.teamId}/members/${anna}/immunity`, {
      reason: 'aus Versehen',
    });
    const revoked = await call<TeamView>(
      'DELETE',
      `/api/teams/${team.teamId}/members/${anna}/immunity`,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.immunities).toEqual([]);
    // Without an immunity there is nothing to revoke.
    expect(
      (await call('DELETE', `/api/teams/${team.teamId}/members/${anna}/immunity`)).status,
    ).toBe(404);
  });

  it('pools can be renamed and deleted; past spins are untouched', async () => {
    const team = await teamWith(['Anna', 'Bob']);
    const anna = team.members[0]?.memberId ?? '';
    const withPool = await call<TeamView>('POST', `/api/teams/${team.teamId}/pools`, {
      name: 'Backend',
      memberIds: [anna],
    });
    const poolId = withPool.body.pools[0]?.poolId ?? '';

    const renamed = await call<TeamView>(
      'POST',
      `/api/teams/${team.teamId}/pools/${poolId}/rename`,
      {
        name: 'Plattform',
      },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.pools[0]?.name).toBe('Plattform');

    const spinId = crypto.randomUUID();
    await call('POST', `/api/teams/${team.teamId}/spins`, { spinId, poolId });
    await call('POST', `/api/teams/${team.teamId}/spins/${spinId}/reveal`, { clientSeed: 'x' });

    const deleted = await call<TeamView>('DELETE', `/api/teams/${team.teamId}/pools/${poolId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.pools).toEqual([]);
    expect(deleted.body.spins).toHaveLength(1); // the pool's draw history survives
    expect((await call('DELETE', `/api/teams/${team.teamId}/pools/${poolId}`)).status).toBe(404);
  });

  it('validates input and policy', async () => {
    const team = await teamWith(['Anna']);
    expect((await call('POST', '/api/teams', { name: '' })).status).toBe(400);
    expect(
      (await call('POST', `/api/teams/${team.teamId}/members`, { name: 'x'.repeat(101) })).status,
    ).toBe(400);
    expect((await call('POST', `/api/teams/${team.teamId}/spins`, { spinId: '../x' })).status).toBe(
      400,
    );
    expect((await call('PUT', `/api/teams/${team.teamId}/policy`, { pity: {} })).status).toBe(400);
    expect((await call('GET', '/api/teams/nope')).status).toBe(404);
    expect((await call('GET', '/api/teams/%E0%A4%A')).status).toBe(400);
    expect(
      (
        await call('PUT', `/api/teams/${team.teamId}/policy`, {
          ...team.policy,
          manual: { enabled: true, factors: { ghost: 500 } },
        })
      ).status,
    ).toBe(400);
    const res = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const ok = await call<TeamView>('PUT', `/api/teams/${team.teamId}/policy`, {
      ...team.policy,
      pity: { enabled: true, percentPerSpin: 10 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.policy.pity).toEqual({ enabled: true, percentPerSpin: 10 });
  });

  it('streams appended events over SSE', async () => {
    const team = await teamWith(['Anna']);
    const res = await fetch(`${base}/api/teams/${team.teamId}/events`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    await call('POST', `/api/teams/${team.teamId}/members`, { name: 'Bob' });
    let text = '';
    while (!text.includes('MemberJoined')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    expect(text).toContain('event: appended');
    expect(text).toContain('"type":"MemberJoined"');
    await reader.cancel();
  });

  it('503s the SSE stream past the per-team connection cap with the {error, code} shape', async () => {
    // Mirrors MAX_SSE_CLIENTS_PER_TEAM in http.ts.
    const MAX_SSE_CLIENTS_PER_TEAM = 100;
    const team = await teamWith(['Anna']);
    const conns = await Promise.all(
      Array.from({ length: MAX_SSE_CLIENTS_PER_TEAM }, () =>
        fetch(`${base}/api/teams/${team.teamId}/events`),
      ),
    );
    try {
      const res = await fetch(`${base}/api/teams/${team.teamId}/events`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({
        error: 'Too many concurrent connections for this team',
        code: 'too_many_connections',
      });
    } finally {
      await Promise.all(conns.map((c) => c.body?.cancel()));
    }
  });
});

describe('CSRF / DNS-rebinding defenses', () => {
  it('rejects a state-changing request whose Content-Type is not application/json', async () => {
    const res = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'Team' }),
    });
    expect(res.status).toBe(415);
  });

  it('rejects a cross-origin Origin header', async () => {
    const res = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'Team' }),
    });
    expect(res.status).toBe(403);
  });

  it('allows a same-origin Origin header', async () => {
    const res = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ name: 'Team' }),
    });
    expect(res.status).toBe(201);
  });

  it('allows a request with no Origin header at all (curl-style)', async () => {
    const res = await fetch(`${base}/api/teams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Team' }),
    });
    expect(res.status).toBe(201);
  });

  it('enforces SCHULDRAD_ALLOWED_HOSTS when set', async () => {
    const store = openEventStore(':memory:');
    const commands = createCommands(store);
    const http = createHttpServer(commands, null, undefined, {
      SCHULDRAD_ALLOWED_HOSTS: 'schuldrad.internal',
    });
    await new Promise<void>((r) => http.server.listen(0, '127.0.0.1', r));
    const allowlistedBase = `http://127.0.0.1:${(http.server.address() as AddressInfo).port}`;
    try {
      const blocked = await fetch(`${allowlistedBase}/api/teams`);
      expect(blocked.status).toBe(403);

      // fetch()/undici refuse to let user code override the Host header, so
      // hitting the allowed path needs a raw request instead.
      const port = (http.server.address() as AddressInfo).port;
      const allowedStatus = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path: '/api/teams', headers: { host: 'schuldrad.internal' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(allowedStatus).toBe(200);
    } finally {
      await new Promise<void>((r) => http.server.close(() => r()));
      store.close();
    }
  });
});

describe('static fallback', () => {
  async function bootStatic() {
    const dir = await mkdtemp(join(tmpdir(), 'schuldrad-static-'));
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'index.html'), '<html>shell</html>');
    await writeFile(join(dir, 'assets', 'app.abc123.js'), 'console.log(1)');
    const store = openEventStore(':memory:');
    const commands = createCommands(store);
    const http = createHttpServer(commands, dir);
    await new Promise<void>((r) => http.server.listen(0, '127.0.0.1', r));
    return { store, http, base: `http://127.0.0.1:${(http.server.address() as AddressInfo).port}` };
  }

  it('serves an existing hashed asset as immutable', async () => {
    const ctx = await bootStatic();
    try {
      const res = await fetch(`${ctx.base}/assets/app.abc123.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    } finally {
      await new Promise<void>((r) => ctx.http.server.close(() => r()));
      ctx.store.close();
    }
  });

  it('404s a missing asset instead of falling back to the SPA shell', async () => {
    const ctx = await bootStatic();
    try {
      const res = await fetch(`${ctx.base}/assets/missing.js`);
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((r) => ctx.http.server.close(() => r()));
      ctx.store.close();
    }
  });

  it('falls back to the SPA shell with non-immutable caching for a navigation path', async () => {
    const ctx = await bootStatic();
    try {
      const res = await fetch(`${ctx.base}/teams/some-id`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<html>shell</html>');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    } finally {
      await new Promise<void>((r) => ctx.http.server.close(() => r()));
      ctx.store.close();
    }
  });
});
