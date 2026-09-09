import { describe, expect, it } from 'vitest';
import { addMembers } from '../decisions.ts';
import { DomainError } from '../errors.ts';
import type { DomainEvent } from '../events.ts';
import { replay } from '../team.ts';
import { assertPolicy, defaultPolicy, normalizePolicy } from './policy.ts';
import { commitSpin, revealSpin } from './spin.ts';

/** assertPolicy's message text is free-form; the stable contract is the error code. */
function expectPolicyInvalid(policy: unknown) {
  expect(() => assertPolicy(policy)).toThrow(DomainError);
  try {
    assertPolicy(policy);
    expect.fail('expected assertPolicy to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('policy_invalid');
  }
}

function validPolicy(overrides: Partial<typeof defaultPolicy.pity> = {}) {
  return normalizePolicy({
    ...defaultPolicy,
    pity: { ...defaultPolicy.pity, enabled: true, ...overrides },
  });
}

describe('assertPolicy bounds', () => {
  it('accepts the default policy', () => {
    expect(() => assertPolicy(defaultPolicy)).not.toThrow();
  });

  it('rejects a non-integer percentPerSpin', () => {
    expectPolicyInvalid(validPolicy({ percentPerSpin: 0.5 }));
  });

  it('rejects percentPerSpin above the max', () => {
    expectPolicyInvalid(validPolicy({ percentPerSpin: 1001 }));
  });

  it('rejects a negative percentPerSpin', () => {
    expectPolicyInvalid(validPolicy({ percentPerSpin: -1 }));
  });

  it('rejects out-of-range values on both sides of every other bounded field', () => {
    const cases: Array<[string, unknown]> = [
      [
        'cooldown.spins below min',
        normalizePolicy({ ...defaultPolicy, cooldown: { enabled: true, spins: -1 } }),
      ],
      [
        'cooldown.spins above max',
        normalizePolicy({ ...defaultPolicy, cooldown: { enabled: true, spins: 101 } }),
      ],
      [
        'exhaustion.percentPerSelection below min',
        normalizePolicy({
          ...defaultPolicy,
          exhaustion: { enabled: true, percentPerSelection: -1, window: 5 },
        }),
      ],
      [
        'exhaustion.percentPerSelection above max',
        normalizePolicy({
          ...defaultPolicy,
          exhaustion: { enabled: true, percentPerSelection: 101, window: 5 },
        }),
      ],
      [
        'exhaustion.window below min',
        normalizePolicy({
          ...defaultPolicy,
          exhaustion: { enabled: true, percentPerSelection: 30, window: 0 },
        }),
      ],
      [
        'exhaustion.window above max',
        normalizePolicy({
          ...defaultPolicy,
          exhaustion: { enabled: true, percentPerSelection: 30, window: 101 },
        }),
      ],
      [
        'newcomer.factor below min',
        normalizePolicy({
          ...defaultPolicy,
          newcomer: { enabled: true, factor: -1, spins: 3 },
        }),
      ],
      [
        'newcomer.factor above max',
        normalizePolicy({
          ...defaultPolicy,
          newcomer: { enabled: true, factor: 10001, spins: 3 },
        }),
      ],
      [
        'newcomer.spins below min',
        normalizePolicy({
          ...defaultPolicy,
          newcomer: { enabled: true, factor: 500, spins: -1 },
        }),
      ],
      [
        'newcomer.spins above max',
        normalizePolicy({
          ...defaultPolicy,
          newcomer: { enabled: true, factor: 500, spins: 101 },
        }),
      ],
      [
        'manual.factors value below min',
        normalizePolicy({
          ...defaultPolicy,
          manual: { enabled: true, factors: { m1: -1 } },
        }),
      ],
      [
        'manual.factors value above max',
        normalizePolicy({
          ...defaultPolicy,
          manual: { enabled: true, factors: { m1: 10001 } },
        }),
      ],
      [
        'manual.factors value non-integer',
        normalizePolicy({
          ...defaultPolicy,
          manual: { enabled: true, factors: { m1: 2.5 } },
        }),
      ],
    ];
    for (const [, policy] of cases) {
      expectPolicyInvalid(policy);
    }
  });

  it('rejects a non-boolean enabled flag', () => {
    expectPolicyInvalid({ ...defaultPolicy, pity: { ...defaultPolicy.pity, enabled: 'yes' } });
  });

  it('rejects a policy missing a section', () => {
    const { manual: _manual, ...rest } = defaultPolicy;
    expectPolicyInvalid(rest);
  });

  it('rejects manual factor keys that are too long or contain NUL', () => {
    expectPolicyInvalid(
      normalizePolicy({
        ...defaultPolicy,
        manual: { enabled: true, factors: { ['m'.repeat(65)]: 1 } },
      }),
    );
    expectPolicyInvalid(
      normalizePolicy({
        ...defaultPolicy,
        manual: { enabled: true, factors: { 'm1\u0000': 1 } },
      }),
    );
  });

  it(
    'a non-integer percentPerSpin that slipped past assertPolicy wedges every later commitSpin ' +
      'with invalid_modifier_factor, instead of being rejected up front',
    async () => {
      const now = '2026-09-03T10:00:00.000Z';
      const seed = '11'.repeat(32);
      const base: DomainEvent[] = [{ type: 'TeamCreated', teamId: 't1', name: 'Team', at: now }];
      let n = 0;
      const joined = addMembers(replay(base), ['Anna', 'Bob'], () => `m${++n}`, now);
      let state = replay([...base, ...joined]);
      // One prior revealed spin so a member has spinsSinceLastSelection > 0 —
      // otherwise pity's factor (FACTOR_ONE + 0 * percentPerSpin * 10) stays
      // an integer even with a fractional percentPerSpin.
      const commit1 = await commitSpin(state, {
        spinId: 'warmup',
        poolId: null,
        serverSeed: seed,
        now,
      });
      state = replay(commit1.events, state);
      const reveal1 = await revealSpin(state, { spinId: 'warmup', clientSeed: 'cs', now });
      state = replay(reveal1, state);

      state = {
        ...state,
        policy: { ...state.policy, pity: { enabled: true, percentPerSpin: 0.05 } },
      };
      await expect(
        commitSpin(state, { spinId: 's1', poolId: null, serverSeed: seed, now }),
      ).rejects.toMatchObject({ code: 'invalid_modifier_factor' });
    },
  );
});
