import { DomainError } from '../errors.ts';

/**
 * The active fairness policy. Every probability-changing setting lives here
 * and is shown in the UI. Gamification never touches weights.
 */
export type FairnessPolicy = {
  /** +pityPercent per spin without being selected since the last selection. */
  pity: { enabled: boolean; percentPerSpin: number };
  /** Weight 0 for `spins` spins after being selected. */
  cooldown: { enabled: boolean; spins: number };
  /** −percent per selection within the last `window` spins. */
  exhaustion: { enabled: boolean; percentPerSelection: number; window: number };
  /** Multiply by `factor` (1000 = 1×) while a member has fewer than `spins` participations. */
  newcomer: { enabled: boolean; factor: number; spins: number };
  /** Explicit per-member factor (1000 = 1×). Members not listed keep their weight. */
  manual: { enabled: boolean; factors: Record<string, number> };
  /** Immunities always apply; a policy can only choose to show it. Kept for symmetry. */
  immunity: { enabled: true };
};

export const defaultPolicy: FairnessPolicy = {
  pity: { enabled: false, percentPerSpin: 25 },
  cooldown: { enabled: false, spins: 1 },
  exhaustion: { enabled: false, percentPerSelection: 30, window: 5 },
  newcomer: { enabled: false, factor: 500, spins: 3 },
  manual: { enabled: false, factors: {} },
  immunity: { enabled: true },
};

const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Validates untrusted input. Returns an error message or null. */
function validatePolicy(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'policy must be an object';
  const p = input as Record<string, unknown>;
  const section = (name: string): Record<string, unknown> | null => {
    const s = p[name];
    return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : null;
  };
  const pity = section('pity');
  const cooldown = section('cooldown');
  const exhaustion = section('exhaustion');
  const newcomer = section('newcomer');
  const manual = section('manual');
  if (!pity || !cooldown || !exhaustion || !newcomer || !manual) return 'policy is incomplete';
  for (const s of [pity, cooldown, exhaustion, newcomer, manual]) {
    if (typeof s.enabled !== 'boolean') return 'enabled must be boolean';
  }
  if (!isInt(pity.percentPerSpin, 0, 1000)) return 'pity.percentPerSpin must be 0..1000';
  if (!isInt(cooldown.spins, 0, 100)) return 'cooldown.spins must be 0..100';
  if (!isInt(exhaustion.percentPerSelection, 0, 100)) {
    return 'exhaustion.percentPerSelection must be 0..100';
  }
  if (!isInt(exhaustion.window, 1, 100)) return 'exhaustion.window must be 1..100';
  if (!isInt(newcomer.factor, 0, 10000)) return 'newcomer.factor must be 0..10000';
  if (!isInt(newcomer.spins, 0, 100)) return 'newcomer.spins must be 0..100';
  if (typeof manual.factors !== 'object' || manual.factors === null) {
    return 'manual.factors must be an object';
  }
  for (const [id, f] of Object.entries(manual.factors as Record<string, unknown>)) {
    if (typeof id !== 'string' || !isInt(f, 0, 10000)) return 'manual factors must be 0..10000';
  }
  return null;
}

/** Throwing variant of validatePolicy that narrows the type for handlers. */
export function assertPolicy(input: unknown): asserts input is FairnessPolicy {
  const problem = validatePolicy(input);
  if (problem !== null) throw new DomainError(problem, 'policy_invalid');
}

/** Drops unknown fields so only the validated shape is persisted. */
export function normalizePolicy(p: FairnessPolicy): FairnessPolicy {
  return {
    pity: { enabled: p.pity.enabled, percentPerSpin: p.pity.percentPerSpin },
    cooldown: { enabled: p.cooldown.enabled, spins: p.cooldown.spins },
    exhaustion: {
      enabled: p.exhaustion.enabled,
      percentPerSelection: p.exhaustion.percentPerSelection,
      window: p.exhaustion.window,
    },
    newcomer: { enabled: p.newcomer.enabled, factor: p.newcomer.factor, spins: p.newcomer.spins },
    manual: { enabled: p.manual.enabled, factors: { ...p.manual.factors } },
    immunity: { enabled: true },
  };
}
