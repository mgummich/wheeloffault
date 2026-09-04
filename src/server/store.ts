import { join } from 'node:path';
import { type EventStore, openEventStore } from './eventStore.ts';

type StoreEnv = Partial<Pick<NodeJS.ProcessEnv, 'DATABASE_URL' | 'EVENT_STORE'>>;

export async function openConfiguredEventStore(
  env: StoreEnv = process.env,
  dataDir = process.env.DATA_DIR ?? 'data',
): Promise<EventStore> {
  const store = env.EVENT_STORE ?? 'sqlite';
  if (store === 'sqlite') return openEventStore(join(dataDir, 'schuldrad.db'));
  if (store === 'postgres') {
    if (!env.DATABASE_URL)
      throw new Error('DATABASE_URL muss für EVENT_STORE=postgres gesetzt sein');
    const { openPostgresEventStore } = await import('./postgresEventStore.ts');
    return openPostgresEventStore(env.DATABASE_URL);
  }
  throw new Error(`Unbekannter EVENT_STORE: ${store}`);
}
