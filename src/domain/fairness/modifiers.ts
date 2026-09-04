import type { FairnessPolicy } from './policy.ts';

/** What a modifier may know about one participant. Derived from history in weights.ts. */
export type ParticipantContext = {
  memberId: string;
  /** Revealed spins this member took part in. */
  participations: number;
  /** Participations since (and excluding) the last official selection; all of them if never selected. */
  spinsSinceLastSelection: number;
  /** Official selections among the team's last `window` revealed spins. */
  selectionsInWindow: (window: number) => number;
  /** True if selected in one of the team's last `n` revealed spins. */
  selectedWithinLast: (n: number) => boolean;
  hasImmunity: boolean;
};

export const FACTOR_ONE = 1000;

/**
 * A modifier returns one integer factor per participant (1000 = unchanged).
 * Modifiers run in the order of `modifierOrder`; that order is part of the
 * fairness contract and is recorded in every SpinCommitted event.
 */
export type WeightModifier = {
  name: string;
  enabled: (policy: FairnessPolicy) => boolean;
  factor: (ctx: ParticipantContext, policy: FairnessPolicy) => number;
};

export const modifierOrder: WeightModifier[] = [
  {
    name: 'pity',
    enabled: (p) => p.pity.enabled,
    factor: (ctx, p) => FACTOR_ONE + ctx.spinsSinceLastSelection * p.pity.percentPerSpin * 10,
  },
  {
    name: 'cooldown',
    enabled: (p) => p.cooldown.enabled,
    factor: (ctx, p) => (ctx.selectedWithinLast(p.cooldown.spins) ? 0 : FACTOR_ONE),
  },
  {
    name: 'exhaustion',
    enabled: (p) => p.exhaustion.enabled,
    factor: (ctx, p) => {
      let f = FACTOR_ONE;
      const hits = ctx.selectionsInWindow(p.exhaustion.window);
      for (let i = 0; i < hits; i++) {
        f = Math.round((f * (100 - p.exhaustion.percentPerSelection)) / 100);
      }
      return f;
    },
  },
  {
    name: 'newcomer',
    enabled: (p) => p.newcomer.enabled,
    factor: (ctx, p) => (ctx.participations < p.newcomer.spins ? p.newcomer.factor : FACTOR_ONE),
  },
  {
    name: 'manual',
    enabled: (p) => p.manual.enabled,
    factor: (ctx, p) => p.manual.factors[ctx.memberId] ?? FACTOR_ONE,
  },
  {
    name: 'immunity',
    enabled: () => true,
    factor: (ctx) => (ctx.hasImmunity ? 0 : FACTOR_ONE),
  },
];
