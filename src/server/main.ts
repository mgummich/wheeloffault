import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCommands } from './commands.ts';
import { openEventStore } from './eventStore.ts';
import { createHttpServer } from './http.ts';

const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? 'data';
mkdirSync(dataDir, { recursive: true });

// Node runs the TypeScript sources directly; only the frontend is built (dist/web).
const here = dirname(fileURLToPath(import.meta.url));
const webDir = process.env.WEB_DIR ?? join(here, '..', '..', 'dist', 'web');

const store = openEventStore(join(dataDir, 'schuldrad.db'));
// The command layer and the HTTP layer reference each other only through this callback.
let broadcast: (teamId: string, events: Parameters<typeof http.broadcast>[1]) => void = () => {};
const commands = createCommands(store, (teamId, events) => broadcast(teamId, events));
const http = createHttpServer(commands, process.env.WEB_DIR === '' ? null : webDir);
broadcast = http.broadcast;

http.server.listen(port, () => {
  console.log(`Schuldrad fährt auf http://localhost:${port} (Daten: ${dataDir})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    http.server.close();
    store.close();
    process.exit(0);
  });
}
