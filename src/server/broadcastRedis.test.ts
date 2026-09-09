import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../domain/events.ts';
import { openRedisBroadcastHub, type PublicEventRef } from './broadcast.ts';

/**
 * broadcast.test.ts exercises createRedisBroadcastHub against a fake redis
 * client (string comparison of what it would have sent). This runs the same
 * publish/subscribe contract against a real Redis server, including the
 * own-origin skip that the fake never proves works against real pub/sub
 * timing. Skips cleanly (not fails) without REDIS_URL.
 */
const REDIS_URL = process.env.REDIS_URL ?? '';

const event: StoredEvent = {
  type: 'TeamCreated',
  teamId: 't1',
  name: 'Team',
  at: '2026-01-01T00:00:00.000Z',
  streamId: 't1',
  version: 1,
  position: 1,
};

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe.skipIf(!REDIS_URL)('redis broadcast hub (requires REDIS_URL)', () => {
  it('publishes from one hub and delivers to another over real Redis, skipping own origin', async () => {
    const deliveredA: [string, PublicEventRef[]][] = [];
    const deliveredB: [string, PublicEventRef[]][] = [];

    const hubA = await openRedisBroadcastHub(REDIS_URL, (teamId, events) =>
      deliveredA.push([teamId, events]),
    );
    const hubB = await openRedisBroadcastHub(REDIS_URL, (teamId, events) =>
      deliveredB.push([teamId, events]),
    );
    try {
      await hubA.broadcast('t1', [event]);

      // hubA delivers its own broadcast exactly once, locally (with the full
      // StoredEvent, per broadcast()'s local deliver() call) — it must not
      // also receive it back over its own subscription (the own-origin skip).
      expect(deliveredA).toEqual([['t1', [event]]]);

      // hubB never called broadcast, so it only ever hears about the event
      // via the real Redis subscription — proving the round trip actually
      // crossed the wire rather than being delivered in-process.
      await waitFor(() => deliveredB.length > 0);
      expect(deliveredB).toEqual([['t1', [{ type: 'TeamCreated', version: 1 }]]]);

      // Give a possible (buggy) echo a moment to arrive before asserting it didn't.
      await new Promise((r) => setTimeout(r, 200));
      expect(deliveredA).toHaveLength(1);
    } finally {
      await hubA.close();
      await hubB.close();
    }
  });
});
