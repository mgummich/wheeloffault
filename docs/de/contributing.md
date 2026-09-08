English → [contributing.md](../en/contributing.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Mitwirkungs-Verordnung

*Schuldrad-Betriebsamt — Direktion für Personal*

## § 1 Werkzeugkette

* **Node ≥ 26**, ohne Ausnahme — der Server führt unveränderten
  `.ts`-Quellcode direkt unter Nodes nativem Type-Stripping aus. Es gibt
  keinen Build-Schritt zur Laufzeit und keinen Bundler in Produktion; eine
  niedrigere Node-Version kann den Server schlicht nicht ausführen.
* **pnpm 11** wie in `packageManager` in `package.json` deklariert. CI
  installiert es über `pnpm/action-setup@v4` (`.github/workflows/pages.yml`,
  `.github/workflows/ci.yml`), nicht über Corepack; das Dockerfile
  installiert es explizit (`npm install -g pnpm@11.24.0`), weil
  das Laufzeit-Image `npm`/`npx`/`corepack` danach entfernt. `.npmrc` setzt
  `auto-install-peers=true`. Die übrige pnpm-Konfiguration steht in
  `pnpm-workspace.yaml` — `allowBuilds: esbuild: true` (erlaubt esbuilds
  Postinstall-Skript zu laufen) und eine `minimumReleaseAgeExclude`-Liste
  von pnpms Mindest-Release-Alter-Prüfung ausgenommenen Paketen —
  und ist so tragend, dass das Dockerfile sie neben `package.json` und dem
  Lockfile ins Build-Image kopiert.
* **Biome** für Formatierung und Linting (`biome.json`) — ein Werkzeug
  statt ESLint + Prettier. `pnpm format` schreibt, `pnpm format:check` und
  `pnpm lint` prüfen nur (so in CI verwendet).
* **TypeScript** via `tsc --noEmit` nur zur Typprüfung; nichts wird von
  `tsc` für den laufenden Server kompiliert (siehe Node ≥ 26 oben). Vite
  kompiliert das Browser-Bundle.
* **Vitest**, aufgeteilt in zwei Projekte (`vitest.config.ts`):
  * `unit` — `src/domain/**/*.test.ts` und `src/web/**/*.test.ts`, pure
    Funktionen und Browser-seitiger Code, kein I/O.
  * `integration` — `src/server/**/*.test.ts`, prüft die HTTP-API und die
    echten Event-Stores.

  `pnpm test:unit` / `pnpm test:integration` einzeln ausführen oder
  `pnpm test` für beide.
* **Playwright** (`playwright.config.ts`) für Ende-zu-Ende-Tests
  (`tests/e2e`), ausgeführt mit `pnpm e2e`. Es baut den Produktionsserver
  und einen statischen Build unter dem Unterpfad `/wheeloffault/`, startet
  beide und führt zwei Projekte gegen sie aus: `server`
  (`journey.spec.ts`) und `static` (`static.spec.ts`) — derselbe Unterpfad,
  auf den GitHub Pages deployed, damit ein kaputter Base-Path vor der
  Produktion auffällt.

## § 2 `pnpm verify`

```
format:check → lint → typecheck → test:unit → test:integration → build
```

Das ist der eine Befehl, der bestehen muss, bevor irgendetwas als fertig
gilt; er läuft auch in CI (`.github/workflows/ci.yml`, Job `verify`).
`audit` läuft parallel dazu; `e2e` und `container` laufen danach und setzen
ihn voraus. Vor dem Öffnen eines PR lokal ausführen — es gibt keine
schnellere Rückmeldeschleife, als nicht auf CI zu warten, um zu erfahren,
dass `lint` fehlgeschlagen ist.

## § 3 Tests leben neben dem, was sie dokumentieren

Unit- und Integrationstests sind `*.test.ts`-Dateien neben dem Modul, das
sie testen, nicht in einem parallelen `tests/`-Baum (außer `tests/e2e`, das
naturgemäß das ganze laufende System umspannt und nicht neben einem Modul
leben kann). Eine Testdatei ist als ausführbare Spezifikation ihres Nachbarn
gedacht — z. B. ist `src/server/api.test.ts` die API-Spec,
`src/web/draw.test.ts` dokumentiert das 409-Wiederaufnahmeverhalten einer
Ziehung. Beim Ändern von Verhalten den benachbarten Test aktualisieren oder
erweitern, nicht anderswo eine neue Testdatei anflanschen.

## § 4 Keine-neuen-Abhängigkeiten-Regel

Vor dem Griff zu einer Bibliothek `dependencies` und `devDependencies` in
`package.json` prüfen. Das Projekt liefert bereits React, Vite, `pg`,
`redis`, Biome, Playwright, `fast-check` und `marked` — das ist bewusst
nahe an der vollständigen Liste. Bevor etwas Neues hinzugefügt wird, in
dieser Reihenfolge fragen:

1. Erledigt das Node-Stdlib das schon? (`node:sqlite`, `node:crypto`,
   `node:http` werden direkt genutzt statt über Wrapper-Bibliotheken.)
2. Erledigt das die Web-Plattform schon? (Web Crypto für Hashing/HMAC —
   siehe [fairness.md](fairness.md) — läuft identisch in Node und im
   Browser, genau deshalb braucht der Fairness-Verifier keine doppelte
   Implementierung.)
3. Sind das eher ein paar Zeilen Code als eine Abhängigkeit? Ein Router,
   ein State-Manager und eine Animationsbibliothek wurden alle bewusst
   nicht hinzugefügt (siehe [architektur.md](architektur.md) § 9)
   — der Hash ist die Route, `TeamView` plus `useState` ist der Zustand,
   und die Rad-Animationen sind handgeschriebene Komponenten.

Eine neue Abhängigkeit ist eine neue Lieferkettenfläche, etwas Neues, das
`pnpm audit` und der Trivy-Scan in CI freigeben müssen, und etwas Neues,
das mit `node:26-alpine` kompatibel gehalten werden muss. Wer eine
Abhängigkeit für wirklich gerechtfertigt hält, begründet das in der
PR-Beschreibung — „ging schneller so“ ist hier kein Grund, der die Review
übersteht.

## § 5 Erwartungen an Commit und PR

`pnpm verify` vor dem Öffnen eines PR ausführen. CI führt zusätzlich
`pnpm audit`, einen E2E-Durchlauf, einen Container-Build mit
Health-Check-Rauchtest, einen Trivy-Sicherheitsscan und eine
SBOM-Erzeugung aus (`.github/workflows/ci.yml`) — ein PR ist erst grün und
mergebar, wenn all das besteht, nicht nur `verify`.
