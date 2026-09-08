import type { HistoryEntry } from './report.ts';

/**
 * Stable slug only. Title/description are UI-facing copy that lives in
 * i18n (`achievement.<id>.title` / `.description`) — this projection stays
 * pure and doesn't know about language.
 */
export type Achievement = { id: string };

export type AchievementInput = {
  totalSelections: number;
  participations: number;
  bestStreak: number;
  schuldindex: number | null;
  fairnessDeviation: number;
  longestDrySpell: number;
  appeals: { filed: number; upheld: number };
  immunitiesEverGranted: number;
  history: HistoryEntry[];
};

type Rule = Achievement & { earned: (m: AchievementInput) => boolean };

/** Purely decorative. None of these influence weights. */
const rules: Rule[] = [
  { id: 'erste-fahrt', earned: (m) => m.totalSelections >= 1 },
  { id: 'stammgast', earned: (m) => m.totalSelections >= 5 },
  { id: 'dauerkarte', earned: (m) => m.totalSelections >= 20 },
  { id: 'doppelschlag', earned: (m) => m.bestStreak >= 2 },
  { id: 'dreifach', earned: (m) => m.bestStreak >= 3 },
  {
    id: 'unschuldslamm',
    earned: (m) => m.participations >= 10 && m.totalSelections === 0,
  },
  {
    id: 'ausreisser',
    earned: (m) => m.participations >= 5 && (m.schuldindex ?? 0) >= 2,
  },
  { id: 'geisterzug', earned: (m) => m.fairnessDeviation <= -2 },
  { id: 'durststrecke', earned: (m) => m.longestDrySpell >= 15 },
  {
    id: 'lotto',
    earned: (m) => m.history.some((h) => h.selected && h.probability < 0.1),
  },
  { id: 'einspruch', earned: (m) => m.appeals.filed >= 1 },
  { id: 'freispruch', earned: (m) => m.appeals.upheld >= 1 },
  { id: 'immunitaet', earned: (m) => m.immunitiesEverGranted >= 1 },
];

export function achievementsFor(m: AchievementInput): Achievement[] {
  return rules.filter((r) => r.earned(m)).map(({ id }) => ({ id }));
}
