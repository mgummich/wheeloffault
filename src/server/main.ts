import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBroadcastHub, openRedisBroadcastHub } from './broadcast.ts';
import { createCommands } from './commands.ts';
import { createHttpServer } from './http.ts';
import { openConfiguredEventStore } from './store.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = process.env.DATA_DIR ?? 'data';
mkdirSync(dataDir, { recursive: true });

// Node runs the TypeScript sources directly; only the frontend is built (dist/web).
const here = dirname(fileURLToPath(import.meta.url));
const webDir = process.env.WEB_DIR ?? join(here, '..', '..', 'dist', 'web');

const store = await openConfiguredEventStore(process.env, dataDir);
// The command layer and the HTTP layer reference each other only through this callback.
let broadcast: (teamId: string, events: Parameters<typeof http.broadcast>[1]) => void = () => {};
const commands = createCommands(store, (teamId, events) => broadcast(teamId, events));
const http = createHttpServer(commands, process.env.WEB_DIR === '' ? null : webDir);
const hub = process.env.REDIS_URL
  ? await openRedisBroadcastHub(process.env.REDIS_URL, http.broadcast)
  : createBroadcastHub(http.broadcast);
broadcast = (teamId, events) => {
  void hub.broadcast(teamId, events).catch((err) => {
    console.error('Broadcast failed', err);
  });
};

http.server.listen(port, host, () => {
  console.log(`Schuldrad fährt auf http://${host}:${port} (Daten: ${dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    http.server.close(() => {
      Promise.all([store.close(), hub.close()]).finally(() => process.exit(0));
    });
  });
}
