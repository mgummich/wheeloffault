import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '../events.ts';
import { replay } from '../team.ts';
import { fahrgastrechte, memberReport, schuldpunkte } from './report.ts';
import { teamStatistics } from './statistics.ts';

const t = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();

/** Two members, uniform weights; `winners` lists who was selected per spin. */
function history(
  winners: string[],
  appeal?: { spin: number; outcome: 'upheld' | 'rejected' },
): DomainEvent[] {
  const events: DomainEvent[] = [
    { type: 'TeamCreated', teamId: 't', name: 'T', at: t(0) },
    { type: 'MemberJoined', memberId: 'a', name: 'Anna', at: t(0) },
    { type: 'MemberJoined', memberId: 'b', name: 'Bob', at: t(0) },
  ];
  winners.forEach((w, i) => {
    const spinId = `s${i}`;
    events.push({
      type: 'SpinCommitted',
      spinId,
      poolId: null,
      nonce: i + 1,
      commitment: 'c',
      serverSeed: '00',
      participants: [
        { memberId: 'a', weight: 1000 },
        { memberId: 'b', weight: 3000 },
      ],
      modifiers: [],
      at: t(i + 1),
    });
    events.push({
      type: 'SpinRevealed',
      spinId,
      serverSeed: '00',
      clientSeed: 'x',
      digest: 'd',
      selectedMemberId: w,
      at: t(i + 1),
    });
    if (appeal && appeal.spin === i) {
      events.push({ type: 'GuiltAppealed', spinId, reason: 'nein', at: t(i + 1) });
      events.push({
        type: appeal.outcome === 'upheld' ? 'AppealUpheld' : 'AppealRejected',
        spinId,
        at: t(i + 1),
      });
    }
  });
  return events;
}

describe('memberReport', () => {
  it('counts selections, expectation, streaks and dry spells', () => {
    const state = replay(history(['a', 'a', 'b', 'a', 'b', 'b']));
    const anna = memberReport(state, 'a');
    expect(anna.totalSelections).toBe(3);
    expect(anna.participations).toBe(6);
    expect(anna.expectedSelections).toBeCloseTo(1.5);
    expect(anna.schuldindex).toBeCloseTo(2);
    expect(anna.fairnessDeviation).toBeCloseTo(1.5);
    expect(anna.bestStreak).toBe(2);
    expect(anna.currentStreak).toBe(0);
    expect(anna.spinsSinceLastSelection).toBe(2);
    expect(anna.lastSelectedAt).toBe(t(4));
    expect(anna.history[0]).toMatchObject({ nonce: 6, selected: false, probability: 0.25 });
    expect(anna.achievements.map((x) => x.id)).toEqual(
      expect.arrayContaining(['erste-fahrt', 'doppelschlag', 'ausreisser']),
    );
    expect(anna.fahrgastrechte).toMatch(/Immunität/);
    expect(anna.entschaedigungsminuten).toBe(90);
  });

  it('an upheld appeal removes the selection but keeps the participation', () => {
    const state = replay(history(['a', 'a'], { spin: 1, outcome: 'upheld' }));
    const anna = memberReport(state, 'a');
    expect(anna.totalSelections).toBe(1);
    expect(anna.participations).toBe(2);
    expect(anna.history[0]?.overturned).toBe(true);
    expect(anna.appeals).toEqual({ filed: 1, upheld: 1 });
    expect(anna.achievements.map((x) => x.id)).toContain('freispruch');
    const rejected = memberReport(
      replay(history(['a', 'a'], { spin: 1, outcome: 'rejected' })),
      'a',
    );
    expect(rejected.totalSelections).toBe(2);
  });

  it('schuldpunkte reward streaks and long odds', () => {
    const h = (selected: boolean, probability: number) => ({
      spinId: '',
      nonce: 0,
      at: '',
      selected,
      probability,
      overturned: false,
    });
    expect(schuldpunkte([h(true, 0.5)])).toBe(100);
    expect(schuldpunkte([h(true, 0.5), h(true, 0.5)].reverse())).toBe(250);
    expect(schuldpunkte([h(true, 0.1)])).toBe(125);
    expect(schuldpunkte([h(false, 0.5)])).toBe(0);
  });

  it('fahrgastrechte thresholds', () => {
    expect(fahrgastrechte(2, 1)).toBeNull();
    expect(fahrgastrechte(3, 3)).toBeNull();
    expect(fahrgastrechte(4, 3)).toMatch(/Formular/);
    expect(fahrgastrechte(6, 3)).toMatch(/Immunität/);
  });
});

describe('teamStatistics', () => {
  it('ranks the hall of shame by points and lists history newest first', () => {
    const state = replay(history(['b', 'a', 'a'], { spin: 0, outcome: 'rejected' }));
    const stats = teamStatistics(state);
    expect(stats.hallOfShame.map((r) => [r.rank, r.name, r.totalSelections])).toEqual([
      [1, 'Anna', 2],
      [2, 'Bob', 1],
    ]);
    expect(stats.totalSpins).toBe(3);
    expect(stats.officialSpins).toBe(3);
    expect(stats.openAppeals).toBe(0);
    expect(stats.history.map((h) => h.nonce)).toEqual([3, 2, 1]);
    expect(stats.history[2]?.appeal?.outcome).toBe('rejected');
    expect(stats.maxFairnessDeviation).toBeCloseTo(1.25);
  });
});
