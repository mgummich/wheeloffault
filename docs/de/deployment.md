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
[README.de.md](../../README.de.md) (überlebt Reload/Tab-schließen/Neustart, wird
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
| `DATA_DIR` | `data` (relativ zum Arbeitsverzeichnis); `/data` im Container-Image | Verzeichnis für `schuldrad.db` |
| `HOST` | `127.0.0.1` | Bind-Adresse — siehe § 4 |
| `WEB_DIR` | `dist/web` (Repository-Root, nicht Arbeitsverzeichnis) | Verzeichnis, aus dem das statische Frontend ausgeliefert wird; leerer String deaktiviert die Frontend-Auslieferung (nur API) |
| `EVENT_STORE` | `sqlite` | `sqlite` oder `postgres` |
| `DATABASE_URL` | — | erforderlich bei `EVENT_STORE=postgres` |
| `REDIS_URL` | — | optional; aktiviert instanzübergreifendes SSE-Fanout |
| `SCHULDRAD_PASSWORD` | — | optionales Betriebspasswort — siehe § 3a |
| `SCHULDRAD_PASSWORD_FILE` | — | optional; Pfad zu einer Datei mit dem Passwort (Docker-Secret) — hat Vorrang vor `SCHULDRAD_PASSWORD`, wenn beide gesetzt sind |
| `SCHULDRAD_SECURE_COOKIES` | — | auf `1` setzen, um das `Secure`-Cookie-Attribut zu erzwingen — siehe § 3a |
| `SCHULDRAD_TRUST_PROXY` | — | auf `1` setzen hinter einem Reverse Proxy, der `x-forwarded-for`/`x-forwarded-proto` überschreibt (nicht anhängt) — siehe § 3a und § 3b |
| `SCHULDRAD_ALLOWED_HOSTS` | — | optionale, kommagetrennte `Host`-Allowlist für `/api/*`-Anfragen, schließt DNS-Rebinding — siehe § 3b |

## § 3a Optionaler Passwortschutz

Der Serverbetrieb kann ein einzelnes Betriebspasswort verlangen, bevor
Team-Daten erreichbar sind. Standardmäßig aus — `SCHULDRAD_PASSWORD` (oder
`SCHULDRAD_PASSWORD_FILE` für ein Docker-Secret) setzen, um es zu
aktivieren:

```bash
docker run -d -p 127.0.0.1:3000:3000 \
  -v schuldrad-data:/data \
  -e SCHULDRAD_PASSWORD=correct-horse-battery-staple \
  schuldrad
```

Oder mit einem Docker-Secret (die Datei gewinnt, wenn beide gesetzt sind):

```yaml
services:
  schuldrad:
    build: .
    secrets:
      - schuldrad_password
    environment:
      SCHULDRAD_PASSWORD_FILE: /run/secrets/schuldrad_password
secrets:
  schuldrad_password:
    file: ./schuldrad_password.txt
```

Das Passwort wird von Schuldrad selbst nie auf Platte geschrieben und nie
geloggt. Beim Start leitet der Server mit scrypt gegen ein zufälliges,
nur im Speicher gehaltenes Salt einen Prüfwert ab; Logins werden
zeitkonstant verglichen. Sitzungen liegen in einer In-Memory-`Map` (12h
gleitende TTL, bei Nutzung verlängert) — **ein Neustart des Servers
meldet alle ab**, mit Absicht; es gibt keine Sitzungs-Persistenz, die
verloren gehen könnte.

Das Session-Cookie (`schuldrad_session`) ist `HttpOnly` und
`SameSite=Strict`. Es trägt außerdem `Secure`, wenn `SCHULDRAD_SECURE_COOKIES=1`
explizit gesetzt ist, oder wenn die Anfrage mit `x-forwarded-proto: https`
ankommt **und** `SCHULDRAD_TRUST_PROXY=1` gesetzt ist — der
`x-forwarded-proto`-Header ist sonst von jedem fälschbar, der den Server
direkt erreicht, daher wird er erst berücksichtigt, wenn bestätigt ist,
dass ein Proxy davor steht und ihn kontrolliert. Wird TLS an einem Proxy
terminiert, sowohl `SCHULDRAD_TRUST_PROXY=1` setzen als auch, falls der
Proxy diesen Header nicht selbst setzt, `SCHULDRAD_SECURE_COOKIES=1`.

`SCHULDRAD_TRUST_PROXY=1` stellt außerdem das Login-Rate-Limiting auf den
ersten Eintrag von `x-forwarded-for` statt auf die Socket-IP um — nur
hinter einem Reverse Proxy setzen, der diesen Header überschreibt (nicht
anhängt), sonst kann ein Client sich einen eigenen Wert einschleusen und
das Limit umgehen.

Sitzungen verlängern sich bei Nutzung gleitend (12h), laufen aber
unabhängig von der Aktivität nach 7 Tagen endgültig ab.

**Nur für eine einzelne Instanz.** Sitzungen und die Zähler für das
Login-Rate-Limiting liegen in genau dieser In-Memory-`Map`, pro Prozess —
nichts teilt diesen Zustand über Replicas hinweg, auch `REDIS_URL` nicht
(das fächert nur Domain-Events per SSE instanzübergreifend auf, siehe die
Umgebungsvariablen-Tabelle in § 3 — es berührt keinen Auth-Zustand). Läuft
`SCHULDRAD_PASSWORD` hinter mehr als einer Replica ohne Sticky Sessions,
ergibt sich: eine auf Instanz A erzeugte Sitzung wird von Instanz B als
nicht authentifiziert abgelehnt (zufällige 401 bei gültigem Cookie), ein
Logout auf A kann einen auf B noch offenen Stream nicht schließen, und das
effektive Rate-Limit liegt bei 5×Replicas statt 5. Entweder Clients per
Sticky Sessions am Load Balancer an eine Instanz binden, oder nur eine
einzelne Instanz betreiben, wenn `SCHULDRAD_PASSWORD` gebraucht wird.

Das schützt Team-Daten hinter einem gemeinsamen Geheimnis; es ist keine
Mehrbenutzer-Authentifizierung (keine Einzelkonten, Rollen oder
Audit-Trail) — siehe [SECURITY.md](../../SECURITY.md) für das genaue
Bedrohungsmodell.

## § 3b CSRF- und DNS-Rebinding-Härtung

Unabhängig von § 3a muss jede `/api/*`-Anfrage bei zustandsändernden
Methoden `application/json` sein, und ein vorhandener `Origin`-Header muss
mit `Host` übereinstimmen. Beides ist immer aktiv und braucht keine
Konfiguration.

DNS-Rebinding — eine von einem Angreifer kontrollierte Domain, die auf die
Adresse des Servers auflöst, sodass ein Browser eine Angreiferseite als
Same-Origin damit behandelt — wird nur geschlossen, indem
`SCHULDRAD_ALLOWED_HOSTS` auf eine kommagetrennte Liste der Hostnamen
(mit Port, falls nicht Standard) gesetzt wird, unter denen die Instanz
legitim erreichbar ist, z. B.:

```bash
-e SCHULDRAD_ALLOWED_HOSTS=schuldrad.internal,schuldrad.internal:3000
```

Standardmäßig nicht gesetzt, damit bestehende LAN-Deployments, die über
rohe IP oder einen nicht gelisteten Hostnamen erreicht werden,
unverändert weiterlaufen. Siehe [SECURITY.md](../../SECURITY.md) § 1b für
das vollständige Bedrohungsmodell.

**Der Reverse Proxy muss den ursprünglichen `Host`-Header weiterreichen.**
Die Origin↔Host-Prüfung oben vergleicht den `Origin`-Header des Browsers
mit dem `Host`-Header, den der Server empfängt. Ein Reverse Proxy, der
`Host` auf seine eigene Upstream-Adresse umschreibt — nginx' Standard
`proxy_set_header Host $proxy_host` — lässt dadurch jede
zustandsänderende Browser-Anfrage mit 403 scheitern. Stattdessen den
ursprünglichen `Host` des Clients weiterreichen:

```nginx
proxy_set_header Host $host;
```

**SSE braucht ungepuffertes Proxying.** nginx puffert Upstream-Antworten
standardmäßig, was `/api/teams/:id/events` zurückhält, bis der Puffer voll
ist — das macht Live-Updates zunichte. Der Server sendet auf dieser Antwort
bereits `X-Accel-Buffering: no`, was nginx von sich aus respektiert — dafür
ist keine Konfigurationsänderung nötig. Für andere Proxies (oder als
zusätzliche Absicherung bei nginx) im selben Location-Block ergänzen:

```nginx
proxy_buffering off;
```

**SSE-Verbindungen sind pro Team auf 100 begrenzt.** Ein Team mit mehr
gleichzeitigen `/api/teams/:id/events`-Verbindungen erhält beim nächsten
Verbindungsversuch `503`; dies ist ein fester, nicht konfigurierbarer
Grenzwert (`MAX_SSE_CLIENTS_PER_TEAM` in `src/server/http.ts`).

## § 4 Bind-Adresse, Reverse Proxy und TLS

Der Server bindet standardmäßig an `127.0.0.1` — er lauscht auf keinem
anderen Netzwerk-Interface als Loopback, sofern nicht ausdrücklich anders
konfiguriert. Das ist ein bewusster Standard, kein Versehen: Schuldrad
kommt standardmäßig ohne Authentifizierung (siehe [SECURITY.md](../../SECURITY.md)), also
wäre ein Server, der ohne weiteres Zutun aus dem Netz erreichbar wäre,
einer, den jeder in diesem Netz lesen und verändern könnte.

Um den Server freizugeben:

* **Im Container** ist `HOST=0.0.0.0` im Image gesetzt, damit das
  Port-Mapping (`-p Host:Container`) funktioniert; die tatsächliche
  Freigabe wird dann durch die Host-Adresse gesteuert, an die der
  veröffentlichte Port gebunden wird, z. B. `-p 127.0.0.1:3000:3000`
  (nur Loopback auf dem Host) versus `-p 3000:3000` (alle Interfaces).
* **Auf Bare Metal** `HOST=0.0.0.0` nur setzen, wenn zusätzlich ein
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
