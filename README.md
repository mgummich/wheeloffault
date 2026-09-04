# Schuldrad

Selbst gehostetes, installierbares Schuldrad für das Scrum-Ritual
„Wer ist diesmal schuldig?“. Ersetzt wheelofnames.com durch ein absichtlich
über-professionelles Verantwortungsrad: nachvollziehbare Fairness
(Commit/Reveal, im Browser prüfbar), vollständige Historie, Schuldberichte,
Hall of Shame, Einsprüche, Immunitäten.

Architektur: [ARCHITECTURE.md](ARCHITECTURE.md).

## Betrieb

```bash
docker build -t schuldrad .
docker run -d -p 3000:3000 -v schuldrad-data:/data schuldrad
```

Danach http://localhost:3000 öffnen. Alles liegt in `/data/schuldrad.db`.

## Entwicklung

Voraussetzung: Node ≥ 26, pnpm.

```bash
pnpm install
pnpm dev          # Server auf :3000, Vite auf :5173 mit /api-Proxy
pnpm verify       # format → lint → typecheck → unit → integration → build
pnpm e2e          # Playwright gegen den Vite-Build (vorher: pnpm build)
```

## Struktur

```
src/domain   pure Domäne: Events, Zustand, Fairness, Projektionen (Browser + Node)
src/server   node:http + node:sqlite, Event-Store, Command-Handler, SSE
src/web      React-PWA
tests/e2e    Playwright-Journey
```
