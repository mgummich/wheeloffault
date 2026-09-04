import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { DomainError } from '../domain/errors.ts';
import type { StoredEvent } from '../domain/events.ts';
import { type FairnessPolicy, validatePolicy } from '../domain/fairness/policy.ts';
import { memberReport } from '../domain/projections/report.ts';
import { ConcurrencyError } from './eventStore.ts';
import type { Commands } from './commands.ts';
import { asObject, id, optionalStr, str, strArray } from './validate.ts';
import { type TeamListEntry, spinView, teamView } from './views.ts';

type Req = IncomingMessage;
type Res = ServerResponse;
type Handler = (req: Req, res: Res, params: Record<string, string>) => Promise<void> | void;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const MAX_BODY = 64 * 1024;

/**
 * Plain node:http. ~15 routes do not justify a framework. Routes are declared
 * with `:param` placeholders and matched in order.
 */
export function createHttpServer(commands: Commands, staticDir: string | null) {
  const routes: Route[] = [];
  const sseClients = new Map<string, Set<Res>>();

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

  /** Called by the command layer after every successful append. */
  function broadcast(teamId: string, events: StoredEvent[]) {
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
    const problem = validatePolicy(body);
    if (problem) throw new DomainError(problem);
    json(
      res,
      200,
      teamView(await commands.changePolicy(id(p.teamId ?? ''), body as FairnessPolicy)),
    );
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
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const clients = sseClients.get(teamId) ?? new Set<Res>();
    clients.add(res);
    sseClients.set(teamId, clients);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(teamId);
    });
  });

  async function handle(req: Req, res: Res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
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
        json(res, 404, { error: 'Unbekannte Route' });
        return;
      }
      if (staticDir) await serveStatic(staticDir, url.pathname, res);
      else json(res, 404, { error: 'Kein Frontend gebaut' });
    } catch (err) {
      if (err instanceof DomainError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
        json(res, status, { error: err.message, ...err.details });
      } else if (err instanceof ConcurrencyError) {
        json(res, 409, { error: 'Gleichzeitige Änderung, bitte erneut versuchen' });
      } else if (
        err instanceof SyntaxError ||
        (err instanceof Error && err.message === 'body too large')
      ) {
        json(res, 400, { error: 'Ungültiger Request-Body' });
      } else {
        console.error(err);
        json(res, 500, { error: 'Interner Fehler' });
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
    throw new DomainError('Ungültige URL-Kodierung');
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
  let file = join(dir, safe);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(dir, 'index.html');
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    // A bare directory or unreadable path: the hash router takes over.
    file = join(dir, 'index.html');
    body = await readFile(file);
  }
  const ext = extname(file);
  const immutable = safe.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': mime[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(body);
}
