// Deterministic fixture for visual regression tests: a team + a committed
// (not yet revealed) spin, seeded directly into the session store (the
// localStorage-backed event log `createSessionApi` in src/web/sessionApi.ts
// uses in static/PWA mode). The commit step already ran with a fixed
// serverSeed — nothing here bypasses commit/reveal, it just pins both seeds
// so the real protocol always resolves the same way.
//
// The test still calls the app's real "finish draw" action, which performs
// an actual reveal (src/web/draw.ts) against these pre-committed values,
// recomputing and checking the commitment exactly as production code does.
import { commitmentOf } from '../../../src/domain/fairness/draw.ts';

export const TEAM_ID = 'visual-fixture-team';
export const SPIN_ID = 'visual-fixture-spin';
export const SERVER_SEED = 'a'.repeat(64);
export const CLIENT_SEED = 'b'.repeat(32);
const AT = '2024-01-01T00:00:00.000Z';

export const MEMBERS = [
  { memberId: 'm1', name: 'Anna' },
  { memberId: 'm2', name: 'Bob' },
  { memberId: 'm3', name: 'Cem' },
  { memberId: 'm4', name: 'Dana' },
] as const;

/** Expected winner for SERVER_SEED/CLIENT_SEED/these participants — see tests/e2e/visual.spec.ts. */
export const EXPECTED_WINNER = 'Anna';

/**
 * Builds the localStorage payload for `schuldrad.sessionEvents.v1`:
 * TeamCreated, four MemberJoined, and one SpinCommitted (uniform weights, no
 * modifiers — a fresh team's real calculateWeights() output). Reveal is left
 * for the test to trigger through the UI.
 */
export async function buildSessionEvents() {
  const participants = MEMBERS.map((m) => ({ memberId: m.memberId, weight: 1000 }));
  const commitment = await commitmentOf(SERVER_SEED, 1, participants);
  const events: Record<string, unknown>[] = [];
  const push = (type: string, extra: Record<string, unknown>) => {
    events.push({
      type,
      at: AT,
      streamId: TEAM_ID,
      version: events.length + 1,
      position: events.length + 1,
      ...extra,
    });
  };
  push('TeamCreated', { teamId: TEAM_ID, name: 'Fixture Team' });
  for (const m of MEMBERS) push('MemberJoined', { memberId: m.memberId, name: m.name });
  push('SpinCommitted', {
    spinId: SPIN_ID,
    poolId: null,
    nonce: 1,
    commitment,
    participants,
    modifiers: [],
    serverSeed: SERVER_SEED,
  });
  return { nextPosition: events.length + 1, events };
}
