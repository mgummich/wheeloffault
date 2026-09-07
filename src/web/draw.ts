import { randomHex } from '../domain/fairness/draw.ts';
import type { SpinView } from '../server/views.ts';
import { ApiError } from './apiError.ts';
import type { Api } from './serverApi.ts';

/** A refresh mid-reveal must retry with the same client seed, otherwise the server (rightly) refuses. */
export function clientSeedFor(spinId: string): string {
  const key = `schuldrad.clientSeed.${spinId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const seed = randomHex(16);
    sessionStorage.setItem(key, seed);
    return seed;
  } catch {
    return randomHex(16);
  }
}

type DrawApi = Pick<Api, 'commitSpin' | 'revealSpin' | 'getTeam'>;

/**
 * Commit → reveal → return the persisted result. Two 409 races are expected:
 * - commit: someone (or a retry) already opened a spin → finish that one instead;
 * - reveal: another browser revealed first with its own client seed → the
 *   persisted result wins.
 */
export async function performDraw(
  api: DrawApi,
  teamId: string,
  poolId: string | null,
  resumeSpinId?: string,
  seedFor: (spinId: string) => string = clientSeedFor,
): Promise<SpinView> {
  let spinId = resumeSpinId ?? crypto.randomUUID();
  if (!resumeSpinId) {
    try {
      await api.commitSpin(teamId, spinId, poolId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.body.spinId === 'string') {
        spinId = err.body.spinId;
      } else throw err;
    }
  }
  try {
    return await api.revealSpin(teamId, spinId, seedFor(spinId));
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409)) throw err;
    const fresh = await api.getTeam(teamId);
    const done = fresh.spins.find((s) => s.spinId === spinId && s.reveal);
    if (!done) throw err;
    return done;
  }
}
