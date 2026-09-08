import type { AppliedModifier, WeightedParticipant } from './events.ts';
import type { FairnessPolicy } from './fairness/policy.ts';
import { type TeamStatistics, teamStatistics } from './projections/statistics.ts';
import type { Immunity, Member, Pool, Spin, TeamState } from './team.ts';
import { pendingSpin } from './team.ts';

/**
 * Public HTTP shapes. The only transformation is redaction: a pending spin's
 * server seed never leaves the server before the reveal.
 */

export type SpinView = {
  spinId: string;
  poolId: string | null;
  nonce: number;
  commitment: string;
  participants: WeightedParticipant[];
  modifiers: AppliedModifier[];
  committedAt: string;
  reveal: Spin['reveal'];
  appeal: Spin['appeal'];
};

export type TeamView = {
  teamId: string;
  name: string;
  version: number;
  createdAt: string;
  members: Member[];
  pools: Pool[];
  policy: FairnessPolicy;
  immunities: Immunity[];
  /** Committed but not yet revealed spin, if any. */
  pendingSpin: SpinView | null;
  /** Newest first. */
  spins: SpinView[];
  statistics: TeamStatistics;
};

export function spinView(spin: Spin): SpinView {
  const { serverSeed: _secret, ...rest } = spin;
  return rest;
}

export function teamView(state: TeamState): TeamView {
  const pending = pendingSpin(state);
  return {
    teamId: state.teamId,
    name: state.name,
    version: state.version,
    createdAt: state.createdAt,
    members: state.members,
    pools: state.pools,
    policy: state.policy,
    immunities: state.immunities,
    pendingSpin: pending ? spinView(pending) : null,
    spins: [...state.spins].reverse().map(spinView),
    statistics: teamStatistics(state),
  };
}

export type TeamListEntry = {
  teamId: string;
  name: string;
  memberCount: number;
  spinCount: number;
};
