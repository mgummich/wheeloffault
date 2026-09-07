import { DomainError } from '../errors.ts';
import type { AppliedModifier, WeightedParticipant } from '../events.ts';
import { type Member, officialSpins, type TeamState } from '../team.ts';
import { FACTOR_ONE, modifierOrder, type ParticipantContext } from './modifiers.ts';

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
  // Index into state.spins of the member's last official selection, -1 if never selected.
  const officialSet = new Set(official);
  let lastSelectedIndex = -1;
  state.spins.forEach((s, i) => {
    if (officialSet.has(s) && s.reveal?.selectedMemberId === memberId) lastSelectedIndex = i;
  });
  const spinIndex = new Map(state.spins.map((s, i) => [s, i]));
  const spinsSinceLastSelection = participated.filter(
    (s) => (spinIndex.get(s) ?? -1) > lastSelectedIndex,
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
  return weigh(state, members, false);
}

function weigh(state: TeamState, members: Member[], skipCooldown: boolean): WeightResult {
  if (members.length === 0) throw new DomainError('Keine aktiven Teilnehmer');
  const contexts = members.map((m) => participantContext(state, m.memberId));
  const weights = new Map(members.map((m) => [m.memberId, FACTOR_ONE]));
  const modifiers: AppliedModifier[] = [];
  for (const modifier of modifierOrder) {
    if (!modifier.enabled(state.policy)) continue;
    const factors: Record<string, number> = {};
    for (const ctx of contexts) {
      const f =
        modifier.name === 'cooldown' && skipCooldown
          ? FACTOR_ONE
          : modifier.factor(ctx, state.policy);
      if (!Number.isInteger(f) || f < 0) {
        throw new DomainError(`Modifikator ${modifier.name} lieferte ungültigen Faktor ${f}`);
      }
      factors[ctx.memberId] = f;
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
    // Evaluate the fallback after all exclusions. Preserve modifier order and
    // rounding by replaying the calculation with neutral cooldown factors.
    if (!skipCooldown && state.policy.cooldown.enabled) return weigh(state, members, true);
    throw new DomainError('Alle Gewichte sind 0 – niemand kann gezogen werden');
  }
  return { participants, modifiers };
}
