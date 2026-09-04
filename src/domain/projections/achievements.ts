import type { HistoryEntry } from './report.ts';

export type Achievement = { id: string; title: string; description: string };

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
  {
    id: 'erste-fahrt',
    title: 'Erste Fahrt',
    description: 'Zum ersten Mal schuldig.',
    earned: (m) => m.totalSelections >= 1,
  },
  {
    id: 'stammgast',
    title: 'Stammgast',
    description: '5 Schuldsprüche.',
    earned: (m) => m.totalSelections >= 5,
  },
  {
    id: 'dauerkarte',
    title: 'BahnCard 100',
    description: '20 Schuldsprüche. Sie fahren praktisch umsonst.',
    earned: (m) => m.totalSelections >= 20,
  },
  {
    id: 'doppelschlag',
    title: 'Anschlusszug',
    description: 'Zweimal hintereinander schuldig.',
    earned: (m) => m.bestStreak >= 2,
  },
  {
    id: 'dreifach',
    title: 'Schienenersatzverkehr',
    description: 'Dreimal hintereinander. Der Betrieb ist gestört.',
    earned: (m) => m.bestStreak >= 3,
  },
  {
    id: 'unschuldslamm',
    title: 'Unschuldslamm',
    description: '10 Teilnahmen, nie schuldig.',
    earned: (m) => m.participations >= 10 && m.totalSelections === 0,
  },
  {
    id: 'ausreisser',
    title: 'Statistischer Ausreißer',
    description: 'Schuldindex ≥ 2 bei mindestens 5 Teilnahmen.',
    earned: (m) => m.participations >= 5 && (m.schuldindex ?? 0) >= 2,
  },
  {
    id: 'geisterzug',
    title: 'Geisterzug',
    description: 'Mindestens 2 Schuldsprüche unter dem Erwartungswert.',
    earned: (m) => m.fairnessDeviation <= -2,
  },
  {
    id: 'durststrecke',
    title: 'Langstrecke',
    description: '15 Teilnahmen am Stück ohne Schuld.',
    earned: (m) => m.longestDrySpell >= 15,
  },
  {
    id: 'lotto',
    title: 'Sechser im Lotto',
    description: 'Schuldig mit weniger als 10 % Wahrscheinlichkeit.',
    earned: (m) => m.history.some((h) => h.selected && h.probability < 0.1),
  },
  {
    id: 'einspruch',
    title: 'Fahrgastrechte-Formular',
    description: 'Einspruch eingelegt.',
    earned: (m) => m.appeals.filed >= 1,
  },
  {
    id: 'freispruch',
    title: 'Freigesprochen',
    description: 'Ein Einspruch wurde stattgegeben.',
    earned: (m) => m.appeals.upheld >= 1,
  },
  {
    id: 'immunitaet',
    title: '1. Klasse',
    description: 'Einmal immun gewesen.',
    earned: (m) => m.immunitiesEverGranted >= 1,
  },
];

export function achievementsFor(m: AchievementInput): Achievement[] {
  return rules
    .filter((r) => r.earned(m))
    .map(({ id, title, description }) => ({ id, title, description }));
}
