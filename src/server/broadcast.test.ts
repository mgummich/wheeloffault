import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../domain/events.ts';
import { createBroadcastHub, createRedisBroadcastHub, type PublicEventRef } from './broadcast.ts';

const event: StoredEvent = {
  type: 'TeamCreated',
  teamId: 't1',
  name: 'Team',
  at: '2026-01-01T00:00:00.000Z',
  streamId: 't1',
  version: 1,
  position: 1,
};

class FakeRedisClient {
  published: { channel: string; message: string }[] = [];
  subscription: ((message: string) => void | Promise<void>) | null = null;

  async connect() {}

  async publish(channel: string, message: string) {
    this.published.push({ channel, message });
  }

  async subscribe(_channel: string, listener: (message: string) => void | Promise<void>) {
    this.subscription = listener;
  }

  duplicate() {
    return new FakeRedisClient();
  }

  async quit() {}
}

describe('broadcast hubs', () => {
  it('delivers in-process broadcasts locally', async () => {
    const delivered: [string, PublicEventRef[]][] = [];
    const hub = createBroadcastHub((teamId, events) => delivered.push([teamId, events]));

    await hub.broadcast('t1', [event]);

    expect(delivered).toEqual([['t1', [event]]]);
  });

  it('publishes local broadcasts and forwards remote redis messages', async () => {
    const delivered: [string, PublicEventRef[]][] = [];
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    publisher.duplicate = () => subscriber;

    const hub = await createRedisBroadcastHub(
      'redis://localhost:6379',
      (teamId, events) => delivered.push([teamId, events]),
      () => publisher,
      'instance-a',
    );

    await hub.broadcast('t1', [event]);
    expect(delivered).toEqual([['t1', [event]]]);
    expect(publisher.published).toHaveLength(1);

    const published = JSON.parse(publisher.published[0]?.message ?? '{}');
    expect(published.events).toEqual([{ type: 'TeamCreated', version: 1 }]);
    expect(published.events[0]).not.toHaveProperty('serverSeed');

    await subscriber.subscription?.(
      JSON.stringify({
        origin: 'instance-b',
        teamId: 't2',
        events: [{ type: 'TeamCreated', version: 1 }],
      }),
    );
    expect(delivered.at(-1)).toEqual(['t2', [{ type: 'TeamCreated', version: 1 }]]);

    await subscriber.subscription?.(publisher.published[0]?.message ?? '');
    expect(delivered).toHaveLength(2);

    await hub.close();
  });

  it('ignores malformed redis messages', async () => {
    const delivered: [string, PublicEventRef[]][] = [];
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    publisher.duplicate = () => subscriber;

    const hub = await createRedisBroadcastHub(
      'redis://localhost:6379',
      (teamId, events) => delivered.push([teamId, events]),
      () => publisher,
      'instance-a',
    );

    await expect(subscriber.subscription?.('not json')).resolves.toBeUndefined();
    expect(delivered).toEqual([]);

    await hub.close();
  });
});
