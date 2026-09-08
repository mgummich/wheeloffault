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

/** Only what SSE clients need; never leaks a pre-reveal SpinCommitted.serverSeed over Redis. */
export type PublicEventRef = { type: StoredEvent['type']; version: number };

/** deliver() only ever touches `type`/`version` — events arriving over Redis truly are this shape, not a `StoredEvent[]` cast pretending they are. */
type BroadcastSink = (teamId: string, events: PublicEventRef[]) => void;

function isPublicEventRef(value: unknown): value is PublicEventRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type: unknown }).type === 'string' &&
    typeof (value as { version: unknown }).version === 'number'
  );
}

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
  return createRedisBroadcastHub(deliver, () => createClient({ url }) as RedisClient);
}

export async function createRedisBroadcastHub(
  deliver: BroadcastSink,
  createClient: () => RedisClient,
  origin: string = randomUUID(),
): Promise<BroadcastHub> {
  const publisher = createClient();
  const subscriber = publisher.duplicate();
  await Promise.all([publisher.connect(), subscriber.connect()]);

  await subscriber.subscribe(CHANNEL, async (message) => {
    let envelope: unknown;
    try {
      envelope = JSON.parse(message);
    } catch {
      return;
    }
    if (typeof envelope !== 'object' || envelope === null) return;
    const { origin: msgOrigin, teamId, events } = envelope as Record<string, unknown>;
    if (msgOrigin === origin) return;
    if (typeof teamId !== 'string' || !Array.isArray(events)) return;
    const publicEvents = events.filter(isPublicEventRef);
    if (publicEvents.length === 0) return;
    deliver(teamId, publicEvents);
  });

  return {
    async broadcast(teamId, events) {
      deliver(teamId, events);
      const publicEvents: PublicEventRef[] = events.map((e) => ({
        type: e.type,
        version: e.version,
      }));
      await publisher.publish(CHANNEL, JSON.stringify({ origin, teamId, events: publicEvents }));
    },
    async close() {
      await Promise.all([publisher.quit(), subscriber.quit()]);
    },
  };
}
