import { DomainError } from '../errors.ts';
import type { AppliedModifier, WeightedParticipant } from '../events.ts';
import { type Member, type TeamState, officialSpins } from '../team.ts';
import { FACTOR_ONE, type ParticipantContext, modifierOrder } from './modifiers.ts';

export function eligibleMembers(state: TeamState, poolId: string | null): Member[] {
  const pool = poolId ? state.pools.find((p) => p.poolId === poolId) : null;
  if (poolId && !pool) throw new DomainError(`Pool ${poolId} unbekannt`, 'not_found');
  return state.members
    .filter((m) => m.active && (!pool || pool.memberIds.includes(m.memberId)))
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

export function participantContext(state: TeamState, memberId: string): ParticipantContext {
  const revealed = state.spins.filter((s) => s.reveal !== null);
  const official = officialSpins(state);
  const participated = revealed.filter((s) => s.participants.some((p) => p.memberId === memberId));
  const lastSelectedAt = official.reduce(
    (last, s, _i) => (s.reveal?.selectedMemberId === memberId ? state.spins.indexOf(s) : last),
    -1,
  );
  const spinsSinceLastSelection = participated.filter(
    (s) => state.spins.indexOf(s) > lastSelectedAt,
  ).length;
  const recent = (n: number) => revealed.slice(Math.max(0, revealed.length - n));
  return {
    memberId,
    participations: participated.length,
    spinsSinceLastSelection,
    selectionsInWindow: (window) =>
      recent(window).filter(
        (s) => s.reveal?.selectedMemberId === memberId && s.appeal?.outcome !== 'upheld',
      ).length,
    selectedWithinLast: (n) =>
      recent(n).some(
        (s) => s.reveal?.selectedMemberId === memberId && s.appeal?.outcome !== 'upheld',
      ),
    hasImmunity: state.immunities.some((i) => i.memberId === memberId),
  };
}

export type WeightResult = {
  participants: WeightedParticipant[];
  modifiers: AppliedModifier[];
};

/**
 * weights + context → weights. Every participant starts at 1000 (uniform);
 * each enabled modifier contributes an integer factor. Rounding after every
 * step keeps the result exact integers on every platform.
 */
export function calculateWeights(state: TeamState, members: Member[]): WeightResult {
  if (members.length === 0) throw new DomainError('Keine aktiven Teilnehmer');
  const contexts = members.map((m) => participantContext(state, m.memberId));
  const weights = new Map(members.map((m) => [m.memberId, FACTOR_ONE]));
  const modifiers: AppliedModifier[] = [];
  for (const modifier of modifierOrder) {
    if (!modifier.enabled(state.policy)) continue;
    const factors: Record<string, number> = {};
    for (const ctx of contexts) {
      const f = modifier.factor(ctx, state.policy);
      if (!Number.isInteger(f) || f < 0) {
        throw new DomainError(`Modifikator ${modifier.name} lieferte ungültigen Faktor ${f}`);
      }
      factors[ctx.memberId] = f;
    }
    // A cooldown that would exclude everybody (small team, long cooldown) can never
    // expire on its own, so it is skipped for this spin. The recorded factors show it.
    const zeroesEveryone = contexts.every(
      (ctx) => (weights.get(ctx.memberId) ?? 0) * (factors[ctx.memberId] ?? 0) === 0,
    );
    if (modifier.name === 'cooldown' && zeroesEveryone) {
      for (const ctx of contexts) factors[ctx.memberId] = FACTOR_ONE;
    }
    for (const ctx of contexts) {
      const current = weights.get(ctx.memberId) ?? 0;
      weights.set(ctx.memberId, Math.round((current * (factors[ctx.memberId] ?? 0)) / FACTOR_ONE));
    }
    modifiers.push({ name: modifier.name, factors });
  }
  const participants = members.map((m) => ({
    memberId: m.memberId,
    weight: weights.get(m.memberId) ?? 0,
  }));
  if (participants.every((p) => p.weight === 0)) {
    throw new DomainError('Alle Gewichte sind 0 – niemand kann gezogen werden');
  }
  return { participants, modifiers };
}
