import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import { assertPolicy } from '../domain/fairness/policy.ts';
import { memberReport } from '../domain/projections/report.ts';
import {
  type Auth,
  clearSessionCookieHeader,
  clientIp,
  createAuth,
  parseSessionCookie,
  sessionCookieHeader,
} from './auth.ts';
import type { PublicEventRef } from './broadcast.ts';
import type { Commands } from './commands.ts';
import { ConcurrencyError } from './eventStore.ts';
import { asObject, id, optionalStr, str, strArray } from './validate.ts';
import { spinView, type TeamListEntry, teamView } from '../domain/views.ts';

type Req = IncomingMessage;
type Res = ServerResponse;
type Handler = (req: Req, res: Res, params: Record<string, string>) => Promise<void> | void;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const MAX_BODY = 64 * 1024;
const MAX_SSE_CLIENTS_PER_TEAM = 100;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Plain node:http. ~15 routes do not justify a framework. Routes are declared
 * with `:param` placeholders and matched in order.
 */
export function createHttpServer(
  commands: Commands,
  staticDir: string | null,
  auth: Auth = createAuth({}),
  env: NodeJS.ProcessEnv = process.env,
) {
  const routes: Route[] = [];
  const sseClients = new Map<string, Set<Res>>();
  // sessionId per open SSE connection, so a logout/expiry can close just that session's streams.
  const sseSessionByClient = new Map<Res, string>();
  auth.onSessionEnd((sid) => {
    for (const clients of sseClients.values()) {
      for (const res of clients) {
        if (sseSessionByClient.get(res) === sid) res.end();
      }
    }
  });

  function route(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      })}$`,
    );
    routes.push({ method, pattern, keys, handler });
  }

  const json = (res: Res, status: number, body: unknown) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  /**
   * CSRF / DNS-rebinding defenses for every /api request:
   *  - state-changing requests must be application/json (defeats the
   *    text/plain "simple request" CSRF trick, since that never preflights).
   *  - a present Origin header must match Host (same-origin only; requests
   *    with no Origin at all — curl, server-to-server — are unaffected).
   *  - if SCHULDRAD_ALLOWED_HOSTS is set, Host must be in that allowlist,
   *    closing DNS-rebinding attacks. Unset by default so existing LAN
   *    deployments (reached by IP or any hostname) keep working.
   */
  function checkOriginAndHost(req: Req, res: Res): boolean {
    const host = req.headers.host;
    const allowedHosts = env.SCHULDRAD_ALLOWED_HOSTS;
    if (allowedHosts) {
      const allowed = allowedHosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);
      if (!host || !allowed.includes(host)) {
        json(res, 403, { error: 'Host not allowed', code: 'host_not_allowed' });
        return false;
      }
    }
    if (!STATE_CHANGING_METHODS.has(req.method ?? '')) return true;
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      json(res, 415, {
        error: 'Content-Type must be application/json',
        code: 'unsupported_media_type',
      });
      return false;
    }
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string | null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost === null || originHost !== host) {
        json(res, 403, { error: 'Cross-origin request rejected', code: 'origin_mismatch' });
        return false;
      }
    }
    return true;
  }

  /** Called by the command layer after every successful append. */
  function broadcast(teamId: string, events: PublicEventRef[]) {
    for (const res of sseClients.get(teamId) ?? []) {
      for (const e of events) {
        try {
          res.write(
            `event: appended\ndata: ${JSON.stringify({ type: e.type, version: e.version })}\n\n`,
          );
        } catch (err) {
          // The command is already persisted; a dead listener must not fail it.
          console.error('SSE write failed', err);
        }
      }
    }
  }

  route('GET', '/api/health', (_req, res) => json(res, 200, { ok: true }));

  route('GET', '/api/auth/status', (req, res) => {
    const sid = parseSessionCookie(req);
    const authenticated = auth.enabled && sid !== undefined && auth.touchSession(sid);
    json(res, 200, { enabled: auth.enabled, authenticated });
  });

  route('POST', '/api/auth/login', async (req, res) => {
    if (!auth.enabled) {
      json(res, 404, { error: 'Auth is not enabled', code: 'auth_disabled' });
      return;
    }
    const ip = clientIp(req, env);
    const retryAfterSec = auth.rateLimited(ip);
    if (retryAfterSec !== null) {
      res.setHeader('retry-after', String(retryAfterSec));
      json(res, 429, { error: 'Too many attempts, please wait', code: 'rate_limited' });
      return;
    }
    const body = asObject(await readJson(req));
    const password = str(body, 'password', 200);
    // Recorded before the (slow) scrypt compare, not after, so a burst of
    // concurrent requests can't all sneak past the rate limit at once.
    const attempt = auth.recordAttempt(ip);
    if (!(await auth.verify(password))) {
      json(res, 401, { error: 'Invalid password', code: 'invalid_password' });
      return;
    }
    auth.clearAttempt(ip, attempt);
    const sid = auth.createSession();
    res.setHeader('set-cookie', sessionCookieHeader(sid, auth.secureCookie(req)));
    res.writeHead(204);
    res.end();
  });

  route('POST', '/api/auth/logout', (req, res) => {
    const sid = parseSessionCookie(req);
    if (sid) auth.destroySession(sid);
    res.setHeader('set-cookie', clearSessionCookieHeader(auth.secureCookie(req)));
    res.writeHead(204);
    res.end();
  });

  route('GET', '/api/teams', async (_req, res) => {
    const list: TeamListEntry[] = (await commands.listTeams()).map((t) => ({
      teamId: t.teamId,
      name: t.name,
      memberCount: t.members.filter((m) => m.active).length,
      spinCount: t.spins.filter((s) => s.reveal).length,
    }));
    json(res, 200, list);
  });

  route('POST', '/api/teams', async (req, res) => {
    const body = asObject(await readJson(req));
    json(res, 201, teamView(await commands.createTeam(str(body, 'name', 100))));
  });

  route('GET', '/api/teams/:teamId', async (_req, res, p) =>
    json(res, 200, teamView(await commands.loadTeam(id(p.teamId ?? '')))),
  );

  route('POST', '/api/teams/:teamId/members', async (req, res, p) => {
    const body = asObject(await readJson(req));
    const names = body.names !== undefined ? strArray(body, 'names') : [str(body, 'name', 100)];
    json(res, 200, teamView(await commands.addMembers(id(p.teamId ?? ''), names)));
  });

  route('POST', '/api/teams/:teamId/members/:memberId/deactivate', async (_req, res, p) =>
    json(
      res,
      200,
      teamView(await commands.deactivateMember(id(p.teamId ?? ''), id(p.memberId ?? ''))),
    ),
  );

  route('POST', '/api/teams/:teamId/members/:memberId/reactivate', async (_req, res, p) =>
    json(
      res,
      200,
      teamView(await commands.reactivateMember(id(p.teamId ?? ''), id(p.memberId ?? ''))),
    ),
  );

  route('POST', '/api/teams/:teamId/members/:memberId/immunity', async (req, res, p) => {
    const body = asObject(await readJson(req));
    json(
      res,
      200,
      teamView(
        await commands.grantImmunity(
          id(p.teamId ?? ''),
          id(p.memberId ?? ''),
          optionalStr(body, 'reason', 200) ?? '',
        ),
      ),
    );
  });

  route('GET', '/api/teams/:teamId/members/:memberId/report', async (_req, res, p) =>
    json(res, 200, memberReport(await commands.loadTeam(id(p.teamId ?? '')), id(p.memberId ?? ''))),
  );

  route('PUT', '/api/teams/:teamId/policy', async (req, res, p) => {
    const body = await readJson(req);
    assertPolicy(body);
    json(res, 200, teamView(await commands.changePolicy(id(p.teamId ?? ''), body)));
  });

  route('POST', '/api/teams/:teamId/pools', async (req, res, p) => {
    const body = asObject(await readJson(req));
    json(
      res,
      200,
      teamView(
        await commands.createPool(
          id(p.teamId ?? ''),
          str(body, 'name', 100),
          strArray(body, 'memberIds').map((m) => id(m)),
        ),
      ),
    );
  });

  route('PUT', '/api/teams/:teamId/pools/:poolId', async (req, res, p) => {
    const body = asObject(await readJson(req));
    json(
      res,
      200,
      teamView(
        await commands.changePoolMembers(
          id(p.teamId ?? ''),
          id(p.poolId ?? ''),
          strArray(body, 'memberIds').map((m) => id(m)),
        ),
      ),
    );
  });

  route('POST', '/api/teams/:teamId/pools/:poolId/rename', async (req, res, p) => {
    const body = asObject(await readJson(req));
    json(
      res,
      200,
      teamView(
        await commands.renamePool(id(p.teamId ?? ''), id(p.poolId ?? ''), str(body, 'name', 100)),
      ),
    );
  });

  route('DELETE', '/api/teams/:teamId/pools/:poolId', async (_req, res, p) =>
    json(res, 200, teamView(await commands.deletePool(id(p.teamId ?? ''), id(p.poolId ?? '')))),
  );

  route('DELETE', '/api/teams/:teamId/members/:memberId/immunity', async (_req, res, p) =>
    json(
      res,
      200,
      teamView(await commands.revokeImmunity(id(p.teamId ?? ''), id(p.memberId ?? ''))),
    ),
  );

  route('POST', '/api/teams/:teamId/spins', async (req, res, p) => {
    const body = asObject(await readJson(req));
    const spinId = id(str(body, 'spinId', 64), 'spinId');
    const poolId = optionalStr(body, 'poolId', 64);
    const { spin } = await commands.commitSpin(
      id(p.teamId ?? ''),
      spinId,
      poolId ? id(poolId, 'poolId') : null,
    );
    json(res, 201, spinView(spin));
  });

  route('POST', '/api/teams/:teamId/spins/:spinId/reveal', async (req, res, p) => {
    const body = asObject(await readJson(req));
    const { spin } = await commands.revealSpin(
      id(p.teamId ?? ''),
      id(p.spinId ?? '', 'spinId'),
      str(body, 'clientSeed', 200),
    );
    json(res, 200, spinView(spin));
  });

  route('POST', '/api/teams/:teamId/spins/:spinId/appeal', async (req, res, p) => {
    const body = asObject(await readJson(req));
    json(
      res,
      200,
      teamView(
        await commands.appealGuilt(
          id(p.teamId ?? ''),
          id(p.spinId ?? '', 'spinId'),
          str(body, 'reason', 500),
        ),
      ),
    );
  });

  route('POST', '/api/teams/:teamId/spins/:spinId/appeal/uphold', async (_req, res, p) =>
    json(
      res,
      200,
      teamView(
        await commands.decideAppeal(id(p.teamId ?? ''), id(p.spinId ?? '', 'spinId'), 'upheld'),
      ),
    ),
  );

  route('POST', '/api/teams/:teamId/spins/:spinId/appeal/reject', async (_req, res, p) =>
    json(
      res,
      200,
      teamView(
        await commands.decideAppeal(id(p.teamId ?? ''), id(p.spinId ?? '', 'spinId'), 'rejected'),
      ),
    ),
  );

  route('GET', '/api/teams/:teamId/events', async (req, res, p) => {
    const teamId = id(p.teamId ?? '');
    await commands.loadTeam(teamId); // 404 for unknown teams
    if ((sseClients.get(teamId)?.size ?? 0) >= MAX_SSE_CLIENTS_PER_TEAM) {
      json(res, 503, { error: 'Zu viele gleichzeitige Verbindungen für dieses Team' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const clients = sseClients.get(teamId) ?? new Set<Res>();
    clients.add(res);
    sseClients.set(teamId, clients);
    const sid = parseSessionCookie(req);
    if (sid) sseSessionByClient.set(res, sid);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
      sseSessionByClient.delete(res);
      if (clients.size === 0) sseClients.delete(teamId);
    });
  });

  async function handle(req: Req, res: Res) {
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        throw new DomainError('Invalid request URL', 'invalid_url');
      }
      if (url.pathname.startsWith('/api/') && !checkOriginAndHost(req, res)) return;
      if (
        auth.enabled &&
        url.pathname.startsWith('/api/') &&
        url.pathname !== '/api/health' &&
        !url.pathname.startsWith('/api/auth/')
      ) {
        const sid = parseSessionCookie(req);
        if (!sid || !auth.touchSession(sid)) {
          json(res, 401, { error: 'Authentication required', code: 'unauthorized' });
          return;
        }
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(url.pathname);
        if (!match) continue;
        const params = Object.fromEntries(
          r.keys.map((k, i) => [k, decodePathParam(match[i + 1] ?? '')]),
        );
        await r.handler(req, res, params);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        json(res, 404, { error: 'Unknown route', code: 'unknown_route' });
        return;
      }
      if (staticDir) await serveStatic(staticDir, url.pathname, res);
      else json(res, 404, { error: 'No frontend built', code: 'no_frontend_built' });
    } catch (err) {
      if (err instanceof DomainError) {
        const status = err.status === 'not_found' ? 404 : err.status === 'conflict' ? 409 : 400;
        json(res, status, { error: err.message, code: err.code, ...err.details });
      } else if (err instanceof ConcurrencyError) {
        json(res, 409, {
          error: 'Concurrent change, please retry',
          code: 'team_version_conflict',
        });
      } else if (
        err instanceof SyntaxError ||
        (err instanceof Error && err.message === 'body too large')
      ) {
        json(res, 400, { error: 'Invalid request body', code: 'invalid_body' });
      } else {
        console.error(err);
        json(res, 500, { error: 'Internal error', code: 'internal_error' });
      }
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  return { server, broadcast };
}

function decodePathParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new DomainError('Invalid URL encoding', 'invalid_url');
  }
}

async function readJson(req: Req): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? {} : JSON.parse(text);
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Serves the Vite build; unknown paths fall back to index.html (hash routing). */
async function serveStatic(dir: string, pathname: string, res: Res) {
  // normalize() collapses any `..`; pathname always starts with `/`, so it cannot escape dir.
  const safe = normalize(pathname);
  const isAsset = safe.startsWith('/assets/');
  let file = join(dir, safe);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    // A missing hashed asset is a 404, never the SPA shell (which would then
    // get cached as if it were that immutable asset).
    if (isAsset) {
      res.writeHead(404).end();
      return;
    }
    file = join(dir, 'index.html');
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    if (isAsset) {
      res.writeHead(404).end();
      return;
    }
    // A bare directory or unreadable path: the hash router takes over.
    file = join(dir, 'index.html');
    body = await readFile(file);
  }
  const ext = extname(file);
  const immutable = file === join(dir, safe) && isAsset;
  res.writeHead(200, {
    'content-type': mime[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(body);
}
