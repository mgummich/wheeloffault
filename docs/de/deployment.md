English → [deployment.md](../en/deployment.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Betriebs-Verordnung

*Schuldrad-Betriebsamt — Direktion für Infrastruktur*

## § 1 Zwei Modi, nicht geteilt

| Modus | Build | Daten | Live-Sync | Vertrauensgrenze der Fairness |
|---|---|---|---|---|
| Statisch (GitHub Pages) | `pnpm build` | Browser-`localStorage` | keiner | siehe [fairness.md](fairness.md) § 6a — nur selbstprüfend |
| Server (Docker/Node) | `pnpm build:server` | SQLite oder Postgres | SSE | Seed liegt serverseitig, für Teilnehmer unerreichbar |

Die Modi sind unabhängige Produkte, gebaut aus derselben Quelle; die
statischen Daten eines Teams und seine Serverdaten sind vollständig
getrennt und wandern nie automatisch ineinander.

## § 2 Statischer Modus

`pnpm build` erzeugt `dist/web`, eine eigenständige statische Seite. Sie
wird durch `.github/workflows/pages.yml` bei jedem Push auf `main`
deployed. Es gibt kein Backend: `src/web/sessionApi.ts` führt dieselbe
Command/Decide/Replay-Domänenlogik wie der Server aus, gegen `localStorage`
statt SQLite. Die genaue Persistenz-Semantik steht in
[README.md](../../README.md) (überlebt Reload/Tab-schließen/Neustart, wird
nur über die Website-Daten-Einstellungen des Browsers gelöscht), und was
dieser Modus schützt und was nicht, steht in
[SECURITY.md](../../SECURITY.md).

## § 3 Serverbetrieb

### Docker (empfohlen)

```bash
docker build -t schuldrad .
docker run -d -p 127.0.0.1:3000:3000 -v schuldrad-data:/data schuldrad
```

Das `Dockerfile` ist ein zweistufiger Build: eine `node:26-alpine`-Build-
Stufe führt `pnpm build:server` aus und kürzt auf Produktionsabhängigkeiten;
die Laufzeitstufe entfernt `npm`/`npx`/`corepack` vollständig (der
Container braucht nur `node`), läuft als nicht-root-Benutzer `node` und
liefert den Server als unveränderte TypeScript-Quelle unter Nodes nativem
Type-Stripping aus — kein Bundler, kein Kompilierschritt zur Laufzeit.
`HEALTHCHECK` pollt `/api/health`. Daten liegen standardmäßig im
`/data`-Volume als `schuldrad.db` (SQLite).

### Ohne Docker

```bash
pnpm build:server
pnpm start
```

`build:server` baut das Frontend mit `VITE_API_MODE=server` (über das
eingecheckte `src/web/.env.server`), was den Client vom
`localStorage`-Backend auf das HTTP-Backend umschaltet. `pnpm start` führt
`src/server/main.ts` direkt unter Node ≥ 26 aus.

### Compose-Profile

`docker-compose.yml` definiert zwei Profile:

* **`sqlite`** — ein einzelner `schuldrad`-Dienst, SQLite in einem
  benannten Volume. Das ist der Standardpfad ohne Infrastruktur:

  ```bash
  docker compose --profile sqlite up --build
  ```

* **`overengineered`** — `schuldrad-overengineered` plus
  `postgres:17-alpine` und `redis:7-alpine`, verdrahtet über
  `EVENT_STORE=postgres`, `DATABASE_URL` und `REDIS_URL`:

  ```bash
  docker compose --profile overengineered up --build
  ```

  Dies existiert, weil das erklärte Prinzip des Projekts lautet, dass *das
  System* over-engineered sein darf, auch wenn der Code es nicht darf — es
  ist keine Empfehlung für das Scrum-Rad eines Fünf-Personen-Teams. SQLite
  bleibt aus gutem Grund der Standard.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | HTTP-Listen-Port |
| `DATA_DIR` | `/data` (Container) | Verzeichnis für `schuldrad.db` |
| `HOST` | `127.0.0.1` | Bind-Adresse — siehe § 4 |
| `EVENT_STORE` | `sqlite` | `sqlite` oder `postgres` |
| `DATABASE_URL` | — | erforderlich bei `EVENT_STORE=postgres` |
| `REDIS_URL` | — | optional; aktiviert instanzübergreifendes SSE-Fanout |

## § 4 Bind-Adresse, Reverse Proxy und TLS

Der Server bindet standardmäßig an `127.0.0.1` — er lauscht auf keinem
anderen Netzwerk-Interface als Loopback, sofern nicht ausdrücklich anders
konfiguriert. Das ist ein bewusster Standard, kein Versehen: Schuldrad
kommt ohne Authentifizierung (siehe [SECURITY.md](../../SECURITY.md)), also
wäre ein standardmäßig aus dem Netz erreichbarer Server einer, den jeder in
diesem Netz lesen und verändern könnte.

Um den Server freizugeben:

* **Im Container** ist `HOST=0.0.0.0` im Image gesetzt, damit das
  Port-Mapping (`-p Host:Container`) funktioniert; die tatsächliche
  Freigabe wird dann durch die Host-Adresse gesteuert, an die der
  veröffentlichte Port gebunden wird, z. B. `-p 127.0.0.1:3000:3000`
  (nur Loopback auf dem Host) versus `-p 3000:3000` (alle Interfaces).
* **Auf blankem Metall** `HOST=0.0.0.0` nur setzen, wenn zusätzlich ein
  Reverse Proxy oder eine VPN-Grenze davor steht — nie an alle Interfaces
  in einem sonst offenen Netz binden.
* **TLS** wird von Schuldrad selbst nicht terminiert; es gibt keine
  Zertifikatsbehandlung. Einen Reverse Proxy (nginx, Caddy, Traefik, den
  Load Balancer des Cloud-Anbieters) für die TLS-Terminierung davorsetzen,
  wenn der Server über etwas anderes als ein privates Netz oder einen
  bereits vertraulichen VPN-Tunnel erreicht wird.

Schuldrads eigene Annahme, einmal festgehalten und überall vorausgesetzt:
Es wird in einem vertrauenswürdigen Netz (Team-LAN, VPN) oder hinter einem
Reverse Proxy mit Authentifizierung betrieben. Es ist nicht dafür
ausgelegt, direkt im offenen Internet zu stehen.

## § 5 Migrationen zum Deploy-Zeitpunkt

SQLite- und Postgres-Migrationen (`src/server/migrations.ts`) laufen
automatisch beim Start, jede in eigener Transaktion, protokolliert in
`schema_migrations`. Es gibt keinen separaten „Migrationen ausführen“-
Schritt, an den man sich vor dem Start einer neuen Version erinnern muss —
den Server zu starten ist der Migrationsschritt. Siehe
[events.md](events.md) § 4 zum Hinzufügen einer Migration.
