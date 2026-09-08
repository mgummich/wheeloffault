import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.ts';
import type { DomainEvent } from './events.ts';
import { emptyTeam, replay } from './team.ts';

describe('replay', () => {
  it('rejects an unknown event type instead of skipping it silently', () => {
    const events: DomainEvent[] = [
      { type: 'TeamCreated', teamId: 't1', name: 'Team', at: '2026-01-01T00:00:00.000Z' },
      { type: 'SomethingFromTheFuture', at: '2026-01-01T00:00:01.000Z' } as unknown as DomainEvent,
    ];
    expect(() => replay(events, emptyTeam)).toThrow(DomainError);
    expect(() => replay(events, emptyTeam)).toThrow(/SomethingFromTheFuture/);
  });
});
