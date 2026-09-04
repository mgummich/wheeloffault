import { randomUUID } from 'node:crypto';
import type { StoredEvent } from '../domain/events.ts';

const CHANNEL = 'schuldrad:events';

export type BroadcastHub = {
  broadcast(teamId: string, events: StoredEvent[]): Promise<void>;
  close(): void | Promise<void>;
};

type RedisClient = {
  connect(): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void | Promise<void>): Promise<unknown>;
  duplicate(): RedisClient;
  quit(): Promise<unknown>;
};

type BroadcastSink = (teamId: string, events: StoredEvent[]) => void;

export function createBroadcastHub(deliver: BroadcastSink): BroadcastHub {
  return {
    async broadcast(teamId, events) {
      deliver(teamId, events);
    },
    close() {},
  };
}

export async function openRedisBroadcastHub(
  url: string,
  deliver: BroadcastSink,
): Promise<BroadcastHub> {
  const { createClient } = await import('redis');
  return createRedisBroadcastHub(url, deliver, () => createClient({ url }) as RedisClient);
}

export async function createRedisBroadcastHub(
  _url: string,
  deliver: BroadcastSink,
  createClient: () => RedisClient,
  origin: string = randomUUID(),
): Promise<BroadcastHub> {
  const publisher = createClient();
  const subscriber = publisher.duplicate();
  await Promise.all([publisher.connect(), subscriber.connect()]);

  await subscriber.subscribe(CHANNEL, async (message) => {
    const envelope = JSON.parse(message) as {
      origin: string;
      teamId: string;
      events: StoredEvent[];
    };
    if (envelope.origin === origin) return;
    deliver(envelope.teamId, envelope.events);
  });

  return {
    async broadcast(teamId, events) {
      deliver(teamId, events);
      await publisher.publish(CHANNEL, JSON.stringify({ origin, teamId, events }));
    },
    async close() {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
