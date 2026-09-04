import type { Spin, TeamState } from '../team.ts';
import { findMember, officialSpins } from '../team.ts';
import { type Achievement, achievementsFor } from './achievements.ts';

/** One row of a member's spin history, newest first. */
export type HistoryEntry = {
  spinId: string;
  nonce: number;
  at: string;
  selected: boolean;
  /** Probability this member had in that spin, 0..1. */
  probability: number;
  overturned: boolean;
};

export type MemberReport = {
  memberId: string;
  name: string;
  active: boolean;
  totalSelections: number;
  participations: number;
  /** selections / participations, 0..1 */
  schuldquote: number;
  expectedSelections: number;
  /** selections / expected; 1 = statistically fair, >1 = unlucky */
  schuldindex: number | null;
  fairnessDeviation: number;
  lastSelectedAt: string | null;
  currentStreak: number;
  bestStreak: number;
  spinsSinceLastSelection: number;
  longestDrySpell: number;
  schuldpunkte: number;
  entschaedigungsminuten: number;
  fahrgastrechte: string | null;
  appeals: { filed: number; upheld: number };
  immunitiesHeld: number;
  achievements: Achievement[];
  history: HistoryEntry[];
};

export function probabilityIn(spin: Spin, memberId: string): number {
  const total = spin.participants.reduce((s, p) => s + p.weight, 0);
  const own = spin.participants.find((p) => p.memberId === memberId)?.weight ?? 0;
  return total === 0 ? 0 : own / total;
}

export function memberReport(state: TeamState, memberId: string): MemberReport {
  const member = findMember(state, memberId);
  const official = new Set(officialSpins(state).map((s) => s.spinId));
  const history: HistoryEntry[] = [];
  let expected = 0;
  let selections = 0;
  let streak = 0;
  let bestStreak = 0;
  let dry = 0;
  let longestDry = 0;
  let lastSelectedAt: string | null = null;

  for (const spin of state.spins) {
    if (!spin.reveal) continue;
    if (!spin.participants.some((p) => p.memberId === memberId)) continue;
    const isOfficial = official.has(spin.spinId);
    const selected = isOfficial && spin.reveal.selectedMemberId === memberId;
    // An overturned spin never happened statistically: no hit, no expectation.
    if (isOfficial) expected += probabilityIn(spin, memberId);
    if (selected) {
      selections += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      dry = 0;
      lastSelectedAt = spin.reveal.revealedAt;
    } else {
      streak = 0;
      dry += 1;
      longestDry = Math.max(longestDry, dry);
    }
    history.push({
      spinId: spin.spinId,
      nonce: spin.nonce,
      at: spin.reveal.revealedAt,
      selected,
      probability: probabilityIn(spin, memberId),
      overturned: !isOfficial,
    });
  }

  const participations = history.length;
  const deviation = selections - expected;
  const appealsFiled = state.spins.filter(
    (s) => s.appeal && s.reveal?.selectedMemberId === memberId,
  );
  const appealsUpheld = appealsFiled.filter((s) => s.appeal?.outcome === 'upheld');
  const immunitiesEverGranted =
    state.spins.reduce(
      (n, s) =>
        n + (s.modifiers.find((m) => m.name === 'immunity')?.factors[memberId] === 0 ? 1 : 0),
      0,
    ) + state.immunities.filter((i) => i.memberId === memberId).length;

  const base = {
    memberId,
    name: member.name,
    active: member.active,
    totalSelections: selections,
    participations,
    schuldquote: participations === 0 ? 0 : selections / participations,
    expectedSelections: expected,
    schuldindex: expected === 0 ? null : selections / expected,
    fairnessDeviation: deviation,
    lastSelectedAt,
    currentStreak: streak,
    bestStreak,
    spinsSinceLastSelection: dry,
    longestDrySpell: longestDry,
    // Gamification only reads history. It never feeds back into weights.
    schuldpunkte: schuldpunkte(history),
    entschaedigungsminuten: Math.round(Math.max(0, deviation) * 60),
    fahrgastrechte: fahrgastrechte(selections, expected),
    appeals: { filed: appealsFiled.length, upheld: appealsUpheld.length },
    immunitiesHeld: state.immunities.filter((i) => i.memberId === memberId).length,
    history: [...history].reverse(),
  };
  return {
    ...base,
    achievements: achievementsFor({ ...base, immunitiesEverGranted }),
  };
}

/** 100 points per selection, +50 for each consecutive one, +25 if the odds were below 20 %. */
export function schuldpunkte(history: HistoryEntry[]): number {
  let points = 0;
  let streak = 0;
  for (const h of [...history].reverse()) {
    if (!h.selected) {
      streak = 0;
      continue;
    }
    streak += 1;
    points += 100 + (streak - 1) * 50 + (h.probability < 0.2 ? 25 : 0);
  }
  return points;
}

/**
 * Passenger rights, Deutsche-Bahn style: 25 % over expectation → hint,
 * 50 % over → full entitlement to an immunity. Purely informational; the
 * team decides whether to grant it.
 */
export function fahrgastrechte(selections: number, expected: number): string | null {
  if (selections < 3 || expected === 0) return null;
  const ratio = selections / expected;
  if (ratio >= 1.5) return 'Anspruch auf Entschädigung: 1 Immunität (Schuldindex ≥ 1,5)';
  if (ratio >= 1.25) return 'Fahrgastrechte-Formular liegt bereit (Schuldindex ≥ 1,25)';
  return null;
}
