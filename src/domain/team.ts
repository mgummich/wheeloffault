import { DomainError } from './errors.ts';
import type { AppliedModifier, DomainEvent, WeightedParticipant } from './events.ts';
import { defaultPolicy, type FairnessPolicy } from './fairness/policy.ts';

export type Member = {
  memberId: string;
  name: string;
  active: boolean;
  joinedAt: string;
};

export type Pool = { poolId: string; name: string; memberIds: string[] };

export type Appeal = { reason: string; filedAt: string; outcome: 'open' | 'upheld' | 'rejected' };

export type Spin = {
  spinId: string;
  poolId: string | null;
  nonce: number;
  commitment: string;
  participants: WeightedParticipant[];
  modifiers: AppliedModifier[];
  /** Secret until revealed. */
  serverSeed: string;
  committedAt: string;
  reveal: {
    serverSeed: string;
    clientSeed: string;
    digest: string;
    selectedMemberId: string;
    revealedAt: string;
  } | null;
  appeal: Appeal | null;
};

export type Immunity = { memberId: string; reason: string; grantedAt: string };

export type TeamState = {
  teamId: string;
  name: string;
  /** Number of events folded in. Used as expectedVersion for optimistic concurrency. */
  version: number;
  members: Member[];
  pools: Pool[];
  policy: FairnessPolicy;
  /** In commit order. */
  spins: Spin[];
  /** Unconsumed immunities, oldest first. */
  immunities: Immunity[];
  createdAt: string;
};

export const emptyTeam: TeamState = {
  teamId: '',
  name: '',
  version: 0,
  members: [],
  pools: [],
  policy: defaultPolicy,
  spins: [],
  immunities: [],
  createdAt: '',
};

export function applyEvent(state: TeamState, e: DomainEvent): TeamState {
  const s = { ...state, version: state.version + 1 };
  switch (e.type) {
    case 'TeamCreated':
      return { ...s, teamId: e.teamId, name: e.name, createdAt: e.at };
    case 'MemberJoined':
      return {
        ...s,
        members: [
          ...s.members,
          { memberId: e.memberId, name: e.name, active: true, joinedAt: e.at },
        ],
      };
    case 'MemberDeactivated':
      return { ...s, members: setActive(s.members, e.memberId, false) };
    case 'MemberReactivated':
      return { ...s, members: setActive(s.members, e.memberId, true) };
    case 'PoolCreated':
      return { ...s, pools: [...s.pools, { poolId: e.poolId, name: e.name, memberIds: [] }] };
    case 'PoolMembershipChanged':
      return {
        ...s,
        pools: s.pools.map((p) => (p.poolId === e.poolId ? { ...p, memberIds: e.memberIds } : p)),
      };
    case 'PoolRenamed':
      return {
        ...s,
        pools: s.pools.map((p) => (p.poolId === e.poolId ? { ...p, name: e.name } : p)),
      };
    case 'PoolDeleted':
      return { ...s, pools: s.pools.filter((p) => p.poolId !== e.poolId) };
    case 'FairnessPolicyChanged':
      return { ...s, policy: e.policy };
    case 'SpinCommitted':
      return {
        ...s,
        spins: [
          ...s.spins,
          {
            spinId: e.spinId,
            poolId: e.poolId,
            nonce: e.nonce,
            commitment: e.commitment,
            participants: e.participants,
            modifiers: e.modifiers,
            serverSeed: e.serverSeed,
            committedAt: e.at,
            reveal: null,
            appeal: null,
          },
        ],
      };
    case 'SpinRevealed':
      return {
        ...s,
        spins: updateSpin(s.spins, e.spinId, (spin) => ({
          ...spin,
          reveal: {
            serverSeed: e.serverSeed,
            clientSeed: e.clientSeed,
            digest: e.digest,
            selectedMemberId: e.selectedMemberId,
            revealedAt: e.at,
          },
        })),
      };
    case 'GuiltAppealed':
      return {
        ...s,
        spins: updateSpin(s.spins, e.spinId, (spin) => ({
          ...spin,
          appeal: { reason: e.reason, filedAt: e.at, outcome: 'open' },
        })),
      };
    case 'AppealUpheld':
      return { ...s, spins: setAppealOutcome(s.spins, e.spinId, 'upheld') };
    case 'AppealRejected':
      return { ...s, spins: setAppealOutcome(s.spins, e.spinId, 'rejected') };
    case 'ImmunityGranted':
      return {
        ...s,
        immunities: [...s.immunities, { memberId: e.memberId, reason: e.reason, grantedAt: e.at }],
      };
    case 'ImmunityConsumed':
    case 'ImmunityRevoked': {
      // Remove exactly one immunity of that member (the oldest).
      const idx = s.immunities.findIndex((i) => i.memberId === e.memberId);
      return { ...s, immunities: s.immunities.filter((_, i) => i !== idx) };
    }
    default:
      throw new DomainError(`Unknown event type: ${(e as DomainEvent).type}`, 'unknown_event_type');
  }
}

export function replay(events: DomainEvent[], from: TeamState = emptyTeam): TeamState {
  return events.reduce(applyEvent, from);
}

function setActive(members: Member[], memberId: string, active: boolean): Member[] {
  return members.map((m) => (m.memberId === memberId ? { ...m, active } : m));
}

function updateSpin(spins: Spin[], spinId: string, fn: (s: Spin) => Spin): Spin[] {
  return spins.map((s) => (s.spinId === spinId ? fn(s) : s));
}

function setAppealOutcome(spins: Spin[], spinId: string, outcome: Appeal['outcome']): Spin[] {
  return updateSpin(spins, spinId, (s) =>
    s.appeal ? { ...s, appeal: { ...s.appeal, outcome } } : s,
  );
}

// ---------- lookups ----------

export function findMember(state: TeamState, memberId: string): Member {
  const m = state.members.find((x) => x.memberId === memberId);
  if (!m) throw new DomainError(`Member ${memberId} unknown`, 'member_not_found', { memberId });
  return m;
}

export function findSpin(state: TeamState, spinId: string): Spin {
  const s = state.spins.find((x) => x.spinId === spinId);
  if (!s) throw new DomainError(`Spin ${spinId} unknown`, 'spin_not_found', { spinId });
  return s;
}

export function pendingSpin(state: TeamState): Spin | undefined {
  return state.spins.find((s) => s.reveal === null);
}

/** Spins that have a reveal and were not overturned by an upheld appeal. */
export function officialSpins(state: TeamState): Spin[] {
  return state.spins.filter((s) => s.reveal !== null && s.appeal?.outcome !== 'upheld');
}
