import { describe, expect, it } from 'vitest';
import type { TeamView } from '../../domain/views.ts';
import { poolOptionLabel, spinEligibility } from './SpinPage.tsx';

const team: TeamView = {
  teamId: 't1',
  name: 'Team',
  version: 1,
  createdAt: '2026-09-04T00:00:00.000Z',
  members: [
    { memberId: 'm1', name: 'Anna', active: true, joinedAt: '2026-09-04T00:00:00.000Z' },
    { memberId: 'm2', name: 'Bob', active: false, joinedAt: '2026-09-04T00:00:00.000Z' },
  ],
  pools: [{ poolId: 'p1', name: 'Backend', memberIds: ['m1', 'm2'] }],
  policy: {
    pity: { enabled: false, percentPerSpin: 25 },
    cooldown: { enabled: false, spins: 1 },
    exhaustion: { enabled: false, percentPerSelection: 30, window: 5 },
    newcomer: { enabled: false, factor: 500, spins: 3 },
    manual: { enabled: false, factors: {} },
    immunity: { enabled: true },
  },
  immunities: [],
  pendingSpin: null,
  spins: [],
  statistics: {
    totalSpins: 0,
    officialSpins: 0,
    overturnedSpins: 0,
    openAppeals: 0,
    hallOfShame: [],
    maxFairnessDeviation: 0,
    history: [],
  },
};

describe('poolOptionLabel', () => {
  it('shows active eligible members instead of total pool membership', () => {
    const pool = team.pools[0];
    if (!pool) throw new Error('missing pool');
    expect(poolOptionLabel(team, pool)).toBe('Backend (1 active)');
  });
});

describe('spinEligibility', () => {
  it('describes all-active draws', () => {
    expect(spinEligibility(team, '').message).toBe('1 active participant in the pool.');
  });

  it('describes selected pools and inactive members', () => {
    expect(spinEligibility(team, 'p1')).toEqual({
      eligibleCount: 1,
      disabled: false,
      message: 'Backend: 1 active participant in the pool, 1 signed off.',
    });
  });
});
