import { DomainError } from './errors.ts';
import type { DomainEvent } from './events.ts';
import { type FairnessPolicy, normalizePolicy } from './fairness/policy.ts';
import { findMember, findSpin, type TeamState } from './team.ts';

/**
 * Decision functions: (state, input) → events. Pure; the caller supplies
 * `now` and ids so results are reproducible in tests.
 */

const MAX_NAME = 60;

export function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw new DomainError('Name must not be empty', 'name_empty');
  if (name.length > MAX_NAME) {
    throw new DomainError(`Name longer than ${MAX_NAME} characters`, 'name_too_long', {
      max: MAX_NAME,
    });
  }
  return name;
}

export function createTeam(teamId: string, name: string, now: string): DomainEvent[] {
  return [{ type: 'TeamCreated', teamId, name: cleanName(name), at: now }];
}

export function addMembers(
  state: TeamState,
  names: string[],
  newId: () => string,
  now: string,
): DomainEvent[] {
  const existing = new Set(state.members.filter((m) => m.active).map((m) => m.name.toLowerCase()));
  const events: DomainEvent[] = [];
  for (const raw of names) {
    const name = cleanName(raw);
    const key = name.toLowerCase();
    // Pasted lists often repeat people who are already there; that is not an error.
    if (existing.has(key)) continue;
    existing.add(key);
    events.push({ type: 'MemberJoined', memberId: newId(), name, at: now });
  }
  return events;
}

export function deactivateMember(state: TeamState, memberId: string, now: string): DomainEvent[] {
  const m = findMember(state, memberId);
  if (!m.active) return [];
  return [{ type: 'MemberDeactivated', memberId, at: now }];
}

export function reactivateMember(state: TeamState, memberId: string, now: string): DomainEvent[] {
  const m = findMember(state, memberId);
  if (m.active) return [];
  const duplicate = state.members.some(
    (other) =>
      other.memberId !== memberId &&
      other.active &&
      other.name.toLowerCase() === m.name.toLowerCase(),
  );
  if (duplicate) {
    throw new DomainError('An active member with this name already exists', 'member_name_conflict');
  }
  return [{ type: 'MemberReactivated', memberId, at: now }];
}

export function changePolicy(state: TeamState, policy: FairnessPolicy, now: string): DomainEvent[] {
  for (const id of Object.keys(policy.manual.factors)) {
    if (!state.members.some((m) => m.memberId === id)) {
      throw new DomainError(`manual.factors: unknown member ${id}`, 'unknown_policy_member', {
        memberId: id,
      });
    }
  }
  return [{ type: 'FairnessPolicyChanged', policy: normalizePolicy(policy), at: now }];
}

export function createPool(
  state: TeamState,
  poolId: string,
  name: string,
  memberIds: string[],
  now: string,
): DomainEvent[] {
  const clean = cleanName(name);
  if (state.pools.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
    throw new DomainError('A pool with this name already exists', 'pool_name_conflict');
  }
  return [
    { type: 'PoolCreated', poolId, name: clean, at: now },
    ...changePoolMembers(
      { ...state, pools: [...state.pools, { poolId, name: clean, memberIds: [] }] },
      poolId,
      memberIds,
      now,
    ),
  ];
}

export function changePoolMembers(
  state: TeamState,
  poolId: string,
  memberIds: string[],
  now: string,
): DomainEvent[] {
  if (!state.pools.some((p) => p.poolId === poolId)) {
    throw new DomainError(`Pool ${poolId} unknown`, 'pool_not_found', { poolId });
  }
  const unique = [...new Set(memberIds)];
  for (const id of unique) findMember(state, id);
  return [{ type: 'PoolMembershipChanged', poolId, memberIds: unique, at: now }];
}

export function renamePool(
  state: TeamState,
  poolId: string,
  name: string,
  now: string,
): DomainEvent[] {
  const pool = state.pools.find((p) => p.poolId === poolId);
  if (!pool) throw new DomainError(`Pool ${poolId} unknown`, 'pool_not_found', { poolId });
  const clean = cleanName(name);
  if (pool.name === clean) return [];
  if (
    state.pools.some((p) => p.poolId !== poolId && p.name.toLowerCase() === clean.toLowerCase())
  ) {
    throw new DomainError('A pool with this name already exists', 'pool_name_conflict');
  }
  return [{ type: 'PoolRenamed', poolId, name: clean, at: now }];
}

export function deletePool(state: TeamState, poolId: string, now: string): DomainEvent[] {
  if (!state.pools.some((p) => p.poolId === poolId)) {
    throw new DomainError(`Pool ${poolId} unknown`, 'pool_not_found', { poolId });
  }
  return [{ type: 'PoolDeleted', poolId, at: now }];
}

export function grantImmunity(
  state: TeamState,
  memberId: string,
  reason: string,
  now: string,
): DomainEvent[] {
  findMember(state, memberId);
  return [{ type: 'ImmunityGranted', memberId, reason: reason.trim().slice(0, 200), at: now }];
}

export function revokeImmunity(state: TeamState, memberId: string, now: string): DomainEvent[] {
  findMember(state, memberId);
  if (!state.immunities.some((i) => i.memberId === memberId)) {
    throw new DomainError('No immunity present', 'no_immunity');
  }
  return [{ type: 'ImmunityRevoked', memberId, at: now }];
}

export function appealGuilt(
  state: TeamState,
  spinId: string,
  reason: string,
  now: string,
): DomainEvent[] {
  const spin = findSpin(state, spinId);
  if (!spin.reveal) throw new DomainError('Draw not yet completed', 'spin_not_revealed');
  if (spin.appeal)
    throw new DomainError('An appeal has already been filed', 'appeal_already_filed');
  return [{ type: 'GuiltAppealed', spinId, reason: reason.trim().slice(0, 500), at: now }];
}

export function decideAppeal(
  state: TeamState,
  spinId: string,
  outcome: 'upheld' | 'rejected',
  now: string,
): DomainEvent[] {
  const spin = findSpin(state, spinId);
  if (!spin.appeal) throw new DomainError('No appeal present', 'no_appeal');
  if (spin.appeal.outcome === outcome) return [];
  if (spin.appeal.outcome !== 'open') {
    throw new DomainError('The appeal has already been decided', 'appeal_already_decided');
  }
  return [{ type: outcome === 'upheld' ? 'AppealUpheld' : 'AppealRejected', spinId, at: now }];
}
