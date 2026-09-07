import { describe, expect, it } from 'vitest';
import type { FairnessPolicy } from '../../domain/fairness/policy.ts';
import type { TeamView } from '../../server/views.ts';
import { fairnessSummary } from './FairnessPage.tsx';

const policy: FairnessPolicy = {
  pity: { enabled: true, percentPerSpin: 25 },
  cooldown: { enabled: false, spins: 1 },
  exhaustion: { enabled: true, percentPerSelection: 30, window: 5 },
  newcomer: { enabled: false, factor: 500, spins: 3 },
  manual: { enabled: true, factors: { m1: 1200, m2: 1000 } },
  immunity: { enabled: true },
};

const team: TeamView = {
  teamId: 't1',
  name: 'Team',
  version: 1,
  createdAt: '2026-09-04T00:00:00.000Z',
  members: [
    { memberId: 'm1', name: 'Anna', active: true, joinedAt: '2026-09-04T00:00:00.000Z' },
    { memberId: 'm2', name: 'Bob', active: true, joinedAt: '2026-09-04T00:00:00.000Z' },
  ],
  pools: [],
  policy,
  immunities: [{ memberId: 'm2', reason: 'Fahrgastrecht', grantedAt: '2026-09-04T00:00:00.000Z' }],
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

describe('fairnessSummary', () => {
  it('summarizes active controls and current immunity impact', () => {
    expect(fairnessSummary(policy, team)).toContain('Pity +25 %');
    expect(fairnessSummary(policy, team)).toContain('Erschöpfung -30 %');
    expect(fairnessSummary(policy, team)).toContain('1 manuelle Anpassung');
    expect(fairnessSummary(policy, team)).toContain('1 Immunität');
  });
});
