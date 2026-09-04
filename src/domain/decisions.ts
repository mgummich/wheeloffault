import { DomainError } from './errors.ts';
import type { DomainEvent } from './events.ts';
import { type FairnessPolicy, normalizePolicy } from './fairness/policy.ts';
import { type TeamState, findMember, findSpin } from './team.ts';

/**
 * Decision functions: (state, input) → events. Pure; the caller supplies
 * `now` and ids so results are reproducible in tests.
 */

const MAX_NAME = 60;

export function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw new DomainError('Name darf nicht leer sein');
  if (name.length > MAX_NAME) throw new DomainError(`Name länger als ${MAX_NAME} Zeichen`);
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
  return [{ type: 'MemberReactivated', memberId, at: now }];
}

export function changePolicy(state: TeamState, policy: FairnessPolicy, now: string): DomainEvent[] {
  for (const id of Object.keys(policy.manual.factors)) {
    if (!state.members.some((m) => m.memberId === id)) {
      throw new DomainError(`manual.factors: Mitglied ${id} unbekannt`);
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
    throw new DomainError('Pool mit diesem Namen existiert bereits', 'conflict');
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
    throw new DomainError(`Pool ${poolId} unbekannt`, 'not_found');
  }
  const unique = [...new Set(memberIds)];
  for (const id of unique) findMember(state, id);
  return [{ type: 'PoolMembershipChanged', poolId, memberIds: unique, at: now }];
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

export function appealGuilt(
  state: TeamState,
  spinId: string,
  reason: string,
  now: string,
): DomainEvent[] {
  const spin = findSpin(state, spinId);
  if (!spin.reveal) throw new DomainError('Ziehung noch nicht abgeschlossen');
  if (spin.appeal) throw new DomainError('Einspruch wurde bereits eingelegt', 'conflict');
  return [{ type: 'GuiltAppealed', spinId, reason: reason.trim().slice(0, 500), at: now }];
}

export function decideAppeal(
  state: TeamState,
  spinId: string,
  outcome: 'upheld' | 'rejected',
  now: string,
): DomainEvent[] {
  const spin = findSpin(state, spinId);
  if (!spin.appeal) throw new DomainError('Kein Einspruch vorhanden');
  if (spin.appeal.outcome === outcome) return [];
  if (spin.appeal.outcome !== 'open') {
    throw new DomainError('Einspruch wurde bereits entschieden', 'conflict');
  }
  return [{ type: outcome === 'upheld' ? 'AppealUpheld' : 'AppealRejected', spinId, at: now }];
}
