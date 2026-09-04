import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMembers, deactivateMember, grantImmunity } from '../decisions.ts';
import type { DomainEvent } from '../events.ts';
import { type TeamState, replay } from '../team.ts';
import { defaultPolicy } from './policy.ts';
import { commitSpin, revealSpin } from './spin.ts';
import { calculateWeights, eligibleMembers } from './weights.ts';

const now = '2026-09-03T10:00:00.000Z';
const seed = '11'.repeat(32);

function team(names: string[], extra: DomainEvent[] = []): TeamState {
  let n = 0;
  const base: DomainEvent[] = [{ type: 'TeamCreated', teamId: 't1', name: 'Team', at: now }];
  const joined = addMembers(replay(base), names, () => `m${++n}`, now);
  return replay([...base, ...joined, ...extra]);
}

async function runSpin(state: TeamState, spinId: string, clientSeed = 'cs') {
  const commit = await commitSpin(state, { spinId, poolId: null, serverSeed: seed, now });
  const committed = replay(commit.events, state);
  const reveal = await revealSpin(committed, { spinId, clientSeed, now });
  return replay(reveal, committed);
}

describe('eligibleMembers', () => {
  it('excludes deactivated members and is sorted by memberId', () => {
    const s = team(['Zed', 'Anna', 'Bob']);
    const s2 = replay(deactivateMember(s, 'm2', now), s);
    expect(eligibleMembers(s2, null).map((m) => m.memberId)).toEqual(['m1', 'm3']);
  });
});

describe('calculateWeights', () => {
  it('is uniform by default', () => {
    const { participants, modifiers } = calculateWeights(
      team(['a', 'b']),
      eligibleMembers(team(['a', 'b']), null),
    );
    expect(participants).toEqual([
      { memberId: 'm1', weight: 1000 },
      { memberId: 'm2', weight: 1000 },
    ]);
    expect(modifiers.map((m) => m.name)).toEqual(['immunity']);
  });

  it('immunity zeroes the weight and is consumed by the commit', async () => {
    const s = team(['a', 'b']);
    const immune = replay(grantImmunity(s, 'm1', 'Fahrgastrecht', now), s);
    const commit = await commitSpin(immune, { spinId: 's1', poolId: null, serverSeed: seed, now });
    expect(commit.events.map((e) => e.type)).toEqual(['SpinCommitted', 'ImmunityConsumed']);
    const committed = replay(commit.events, immune);
    expect(committed.spins[0]?.participants).toEqual([
      { memberId: 'm1', weight: 0 },
      { memberId: 'm2', weight: 1000 },
    ]);
    expect(committed.immunities).toEqual([]);
  });

  it('all-zero weights are an error, not a spin', () => {
    const s = team(['a']);
    const immune = replay(grantImmunity(s, 'm1', 'x', now), s);
    expect(() => calculateWeights(immune, eligibleMembers(immune, null))).toThrow(
      /Gewichte sind 0/,
    );
  });

  it('applies modifiers in the fixed order and records factors', async () => {
    let s = team(['a', 'b', 'c']);
    s = replay(
      [
        {
          type: 'FairnessPolicyChanged',
          policy: {
            ...defaultPolicy,
            pity: { enabled: true, percentPerSpin: 50 },
            cooldown: { enabled: true, spins: 1 },
            manual: { enabled: true, factors: { m3: 2000 } },
          },
          at: now,
        },
      ],
      s,
    );
    s = await runSpin(s, 's1');
    const winner = s.spins[0]?.reveal?.selectedMemberId ?? '';
    const { participants, modifiers } = calculateWeights(s, eligibleMembers(s, null));
    expect(modifiers.map((m) => m.name)).toEqual(['pity', 'cooldown', 'manual', 'immunity']);
    const w = Object.fromEntries(participants.map((p) => [p.memberId, p.weight]));
    expect(w[winner]).toBe(0);
    for (const id of ['m1', 'm2', 'm3']) {
      if (id === winner) continue;
      expect(w[id]).toBe(id === 'm3' ? 3000 : 1500); // 1000 × 1.5 pity (× 2 manual for m3)
    }
  });
});

describe('commitSpin / revealSpin', () => {
  it('commits, reveals and reproduces the commitment', async () => {
    const s = await runSpin(team(['a', 'b', 'c']), 's1');
    const spin = s.spins[0];
    expect(spin?.reveal?.selectedMemberId).toMatch(/^m[123]$/);
    expect(spin?.nonce).toBe(1);
    expect(spin?.commitment).toHaveLength(64);
  });

  it('is deterministic: same inputs, same winner', async () => {
    const a = await runSpin(team(['a', 'b', 'c']), 's1', 'same');
    const b = await runSpin(team(['a', 'b', 'c']), 's1', 'same');
    expect(a.spins[0]?.reveal).toEqual(b.spins[0]?.reveal);
  });

  it('retrying a commit with the same spinId is a no-op', async () => {
    const s = team(['a', 'b']);
    const first = await commitSpin(s, { spinId: 's1', poolId: null, serverSeed: seed, now });
    const committed = replay(first.events, s);
    const retry = await commitSpin(committed, {
      spinId: 's1',
      poolId: null,
      serverSeed: 'ff'.repeat(32),
      now,
    });
    expect(retry.events).toEqual([]);
  });

  it('refuses a second spin while one is pending', async () => {
    const s = team(['a', 'b']);
    const first = await commitSpin(s, { spinId: 's1', poolId: null, serverSeed: seed, now });
    const committed = replay(first.events, s);
    await expect(
      commitSpin(committed, { spinId: 's2', poolId: null, serverSeed: seed, now }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { spinId: 's1' },
    });
  });

  it('reveal is idempotent for the same client seed and rejects a different one', async () => {
    const s = await runSpin(team(['a', 'b']), 's1', 'cs');
    expect(await revealSpin(s, { spinId: 's1', clientSeed: 'cs', now })).toEqual([]);
    await expect(revealSpin(s, { spinId: 's1', clientSeed: 'other', now })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('reveal refuses a commit whose stored seed does not match its commitment', async () => {
    const s = team(['a', 'b']);
    const commit = await commitSpin(s, { spinId: 's1', poolId: null, serverSeed: seed, now });
    const tampered = commit.events.map((e) =>
      e.type === 'SpinCommitted' ? { ...e, serverSeed: 'ee'.repeat(32) } : e,
    );
    const committed = replay(tampered, s);
    await expect(revealSpin(committed, { spinId: 's1', clientSeed: 'cs', now })).rejects.toThrow(
      /Commitment/,
    );
  });

  it('property: an inactive member is never selected, weights are finite and ≥ 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 4 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (count, inactiveIdx, clientSeed) => {
          let s = team(Array.from({ length: count }, (_, i) => `p${i}`));
          const inactive = new Set(inactiveIdx.filter((i) => i < count).map((i) => `m${i + 1}`));
          fc.pre(inactive.size < count);
          for (const id of inactive) s = replay(deactivateMember(s, id, now), s);
          s = await runSpin(s, 'sx', clientSeed);
          const spin = s.spins[0];
          const winner = spin?.reveal?.selectedMemberId ?? '';
          expect(inactive.has(winner)).toBe(false);
          expect(spin?.participants.some((p) => inactive.has(p.memberId))).toBe(false);
          for (const p of spin?.participants ?? []) {
            expect(Number.isSafeInteger(p.weight) && p.weight >= 0).toBe(true);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
