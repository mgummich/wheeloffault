import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LEN = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // sliding, touched on every use
const ABSOLUTE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // hard cap regardless of activity
const SESSION_ID_BYTES = 32;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const SWEEP_INTERVAL_MS = 60_000;

export const SESSION_COOKIE = 'schuldrad_session';

/**
 * Optional single-password protection for server mode. One deployment
 * password, verified against a scrypt hash derived once at boot with a
 * random per-boot salt held only in memory (never logged, never persisted).
 * Sessions are an in-memory Map — a restart logs everyone out, which is
 * acceptable for a five-person team's blame wheel.
 */
export interface Auth {
  readonly enabled: boolean;
  verify(candidate: string): Promise<boolean>;
  createSession(): string;
  /** Validates and slides the session's expiry. Returns whether it was (and still is) valid. */
  touchSession(sessionId: string): boolean;
  destroySession(sessionId: string): void;
  /** Called whenever a session ends, by logout, expiry, or the sweep — lets SSE close its streams. */
  onSessionEnd(cb: (sessionId: string) => void): void;
  /** Returns seconds to wait if the IP is currently rate-limited, else null. */
  rateLimited(ip: string): number | null;
  /**
   * Records a login attempt (not just a failure) before the slow scrypt
   * compare runs, so a burst of concurrent requests can't all slip past the
   * rate limit before any of them is counted. Returns a token to hand back
   * to clearAttempt() on success.
   */
  recordAttempt(ip: string): number;
  /** Undoes recordAttempt() after a successful login, so it isn't held against the IP. */
  clearAttempt(ip: string, token: number): void;
  secureCookie(req: IncomingMessage): boolean;
}

function loadPassword(env: NodeJS.ProcessEnv): string | null {
  const file = env.SCHULDRAD_PASSWORD_FILE;
  if (file) {
    // Docker secret: a file wins over the plain env var if both are set.
    const raw = readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    return raw.length > 0 ? raw : null;
  }
  const pw = env.SCHULDRAD_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

export function createAuth(
  env: NodeJS.ProcessEnv,
  opts: { ttlMs?: number; absoluteTtlMs?: number } = {},
): Auth {
  const ttlMs = opts.ttlMs ?? SESSION_TTL_MS;
  const absoluteTtlMs = opts.absoluteTtlMs ?? ABSOLUTE_SESSION_TTL_MS;
  const password = loadPassword(env);
  const enabled = password !== null;
  const salt = randomBytes(16);
  const verifier = enabled
    ? (scryptAsync(password as string, salt, KEY_LEN) as Promise<Buffer>)
    : null;

  const sessions = new Map<string, { expiresAt: number; absoluteExpiresAt: number }>();
  // ponytail: in-memory Map, single-process only — fine for one deployment password.
  const failures = new Map<string, number[]>();
  const sessionEndListeners: ((sid: string) => void)[] = [];

  function endSession(sid: string) {
    if (!sessions.delete(sid)) return;
    for (const cb of sessionEndListeners) cb(sid);
  }

  if (enabled) {
    const sweep = setInterval(() => {
      const now = Date.now();
      for (const [sid, s] of sessions) {
        if (s.expiresAt <= now || s.absoluteExpiresAt <= now) endSession(sid);
      }
      for (const [ip, ts] of failures) {
        const kept = ts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
        if (kept.length === 0) failures.delete(ip);
        else failures.set(ip, kept);
      }
    }, SWEEP_INTERVAL_MS);
    sweep.unref();
  }

  return {
    enabled,
    async verify(candidate) {
      if (!enabled || !verifier) return false;
      const [expected, actual] = await Promise.all([
        verifier,
        scryptAsync(candidate, salt, KEY_LEN) as Promise<Buffer>,
      ]);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
    createSession() {
      const sid = randomBytes(SESSION_ID_BYTES).toString('base64url');
      const now = Date.now();
      sessions.set(sid, { expiresAt: now + ttlMs, absoluteExpiresAt: now + absoluteTtlMs });
      return sid;
    },
    touchSession(sid) {
      const s = sessions.get(sid);
      const now = Date.now();
      if (!s || s.expiresAt <= now || s.absoluteExpiresAt <= now) {
        endSession(sid);
        return false;
      }
      s.expiresAt = Math.min(now + ttlMs, s.absoluteExpiresAt);
      return true;
    },
    destroySession(sid) {
      endSession(sid);
    },
    onSessionEnd(cb) {
      sessionEndListeners.push(cb);
    },
    rateLimited(ip) {
      const now = Date.now();
      const ts = (failures.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      failures.set(ip, ts);
      if (ts.length < RATE_LIMIT_MAX) return null;
      return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - (ts[0] ?? now))) / 1000));
    },
    recordAttempt(ip) {
      const ts = failures.get(ip) ?? [];
      const token = Date.now();
      ts.push(token);
      failures.set(ip, ts);
      return token;
    },
    clearAttempt(ip, token) {
      const ts = failures.get(ip);
      if (!ts) return;
      const idx = ts.indexOf(token);
      if (idx !== -1) ts.splice(idx, 1);
    },
    secureCookie(req) {
      if (env.SCHULDRAD_SECURE_COOKIES === '1') return true;
      return env.SCHULDRAD_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https';
    },
  };
}

/**
 * Client IP for rate-limit keying. Only trusts `x-forwarded-for` when
 * SCHULDRAD_TRUST_PROXY=1 — set this only behind a reverse proxy that
 * overwrites (not appends to) that header, otherwise any client can spoof
 * their rate-limit identity.
 */
export function clientIp(req: IncomingMessage, env: NodeJS.ProcessEnv): string {
  if (env.SCHULDRAD_TRUST_PROXY === '1') {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function parseSessionCookie(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sessionCookieHeader(sessionId: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}
