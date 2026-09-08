import { officialSpins, type TeamState } from '../team.ts';
import { type MemberReport, memberReport } from './report.ts';

export type HallOfShameRow = Pick<
  MemberReport,
  | 'memberId'
  | 'name'
  | 'active'
  | 'totalSelections'
  | 'participations'
  | 'expectedSelections'
  | 'schuldindex'
  | 'schuldpunkte'
  | 'currentStreak'
  | 'lastSelectedAt'
  | 'achievements'
> & { rank: number };

export type SpinSummary = {
  spinId: string;
  nonce: number;
  committedAt: string;
  revealedAt: string | null;
  selectedMemberId: string | null;
  selectedName: string | null;
  participantCount: number;
  appeal: { reason: string; outcome: 'open' | 'upheld' | 'rejected' } | null;
  overturned: boolean;
};

export type TeamStatistics = {
  totalSpins: number;
  officialSpins: number;
  overturnedSpins: number;
  openAppeals: number;
  hallOfShame: HallOfShameRow[];
  /** Largest |selections − expected| across members: how far reality drifted from the policy. */
  maxFairnessDeviation: number;
  history: SpinSummary[];
};

function spinHistory(state: TeamState): SpinSummary[] {
  const names = new Map(state.members.map((m) => [m.memberId, m.name]));
  return state.spins
    .map((s) => ({
      spinId: s.spinId,
      nonce: s.nonce,
      committedAt: s.committedAt,
      revealedAt: s.reveal?.revealedAt ?? null,
      selectedMemberId: s.reveal?.selectedMemberId ?? null,
      selectedName: s.reveal ? (names.get(s.reveal.selectedMemberId) ?? null) : null,
      participantCount: s.participants.filter((p) => p.weight > 0).length,
      appeal: s.appeal ? { reason: s.appeal.reason, outcome: s.appeal.outcome } : null,
      overturned: s.appeal?.outcome === 'upheld',
    }))
    .reverse();
}

export function teamStatistics(state: TeamState): TeamStatistics {
  const reports = state.members.map((m) => memberReport(state, m.memberId));
  const ranked = [...reports].sort(
    (a, b) =>
      b.schuldpunkte - a.schuldpunkte ||
      b.totalSelections - a.totalSelections ||
      a.name.localeCompare(b.name, 'de'),
  );
  const hallOfShame: HallOfShameRow[] = ranked.map((r, i) => ({
    rank: i + 1,
    memberId: r.memberId,
    name: r.name,
    active: r.active,
    totalSelections: r.totalSelections,
    participations: r.participations,
    expectedSelections: r.expectedSelections,
    schuldindex: r.schuldindex,
    schuldpunkte: r.schuldpunkte,
    currentStreak: r.currentStreak,
    lastSelectedAt: r.lastSelectedAt,
    achievements: r.achievements,
  }));
  const revealed = state.spins.filter((s) => s.reveal);
  return {
    totalSpins: revealed.length,
    officialSpins: officialSpins(state).length,
    overturnedSpins: revealed.length - officialSpins(state).length,
    openAppeals: state.spins.filter((s) => s.appeal?.outcome === 'open').length,
    hallOfShame,
    maxFairnessDeviation: reports.reduce((m, r) => Math.max(m, Math.abs(r.fairnessDeviation)), 0),
    history: spinHistory(state),
  };
}
