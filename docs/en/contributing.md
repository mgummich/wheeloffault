Deutsch → [contributing.md](../de/contributing.md)

# Contributing Regulation

*Schuldrad Operations Bureau — Directorate of Personnel*

## § 1 Toolchain

* **Node ≥ 26**, no exceptions — the server runs unmodified `.ts` source
  directly under Node's native type-stripping. There is no build step at
  runtime and no bundler in production; a lower Node version simply cannot
  run the server.
* **pnpm 11** as declared in `packageManager` in `package.json`. CI installs
  it via `pnpm/action-setup@v4` (`.github/workflows/pages.yml`,
  `.github/workflows/ci.yml`), not Corepack; the Dockerfile installs
  it explicitly (`npm install -g pnpm@11.24.0`) because the runtime image
  removes `npm`/`npx`/`corepack` afterward. `.npmrc` sets
  `auto-install-peers=true`. `pnpm-workspace.yaml` carries the rest of the
  pnpm configuration — `allowBuilds: esbuild: true` (permits esbuild's
  postinstall script to run) and a `minimumReleaseAgeExclude` list of
  packages exempted from pnpm's minimum-release-age gate — and is
  load-bearing enough that the Dockerfile copies it into the build image
  alongside `package.json` and the lockfile.
* **Biome** for formatting and linting (`biome.json`) — one tool instead of
  ESLint + Prettier. `pnpm format` writes, `pnpm format:check` and
  `pnpm lint` only check (used in CI).
* **TypeScript** via `tsc --noEmit` for type-checking only; nothing is
  compiled by `tsc` for the running server (see Node ≥ 26, above). Vite
  compiles the browser bundle.
* **Vitest**, split into two projects (`vitest.config.ts`):
  * `unit` — `src/domain/**/*.test.ts` and `src/web/**/*.test.ts`, pure
    functions and browser-side code, no I/O.
  * `integration` — `src/server/**/*.test.ts`, exercising the HTTP API and
    the real event stores.

  Run `pnpm test:unit` / `pnpm test:integration` individually, or `pnpm test`
  for both.
* **Playwright** (`playwright.config.ts`) for end-to-end tests
  (`tests/e2e`), run with `pnpm e2e`. It builds the production server and a
  static build under the `/wheeloffault/` subpath, starts both, and runs
  two projects against them: `server` (`journey.spec.ts`) and `static`
  (`static.spec.ts`) — the same subpath GitHub Pages deploys to, so a
  broken base path is caught before it reaches production.

## § 2 `pnpm verify`

```
format:check → lint → typecheck → test:unit → test:integration → build
```

This is the single command that must pass before anything is considered
done; it is also what CI runs (`.github/workflows/ci.yml`, `verify` job).
`audit` runs in parallel with it; `e2e` and `container` run afterward and
need it to pass. Run it locally before opening a PR — there is no faster
feedback loop than not waiting for CI to tell you `lint` failed.

## § 3 Tests live next to what they document

Unit and integration tests are `*.test.ts` files next to the module they
test, not in a parallel `tests/` tree (except `tests/e2e`, which by nature
spans the whole running system and cannot live next to one module). A test
file is meant to be read as the executable specification of its neighbor —
e.g. `src/server/api.test.ts` is the API spec, `src/web/draw.test.ts`
documents the 409 draw-resumption behavior. When changing behavior, update
or extend the neighboring test, don't bolt a new test file on somewhere
else.

## § 4 No-new-dependencies policy

Check `dependencies` and `devDependencies` in `package.json` before
reaching for a library. The project already ships React, Vite, `pg`,
`redis`, Biome, Playwright, `fast-check`, and `marked` — that is
deliberately close to the full list. Before adding anything new, ask, in
this order:

1. Does Node's stdlib already do this? (`node:sqlite`, `node:crypto`,
   `node:http` are used directly rather than through wrapper libraries.)
2. Does the Web Platform already do this? (Web Crypto for hashing/HMAC —
   see [fairness.md](fairness.md) — runs identically in Node and the
   browser, which is precisely why the fairness verifier needs no
   duplicate implementation.)
3. Is this a few lines of code rather than a dependency? A router, a state
   manager, and an animation library were all deliberately not added (see
   [ARCHITECTURE.md](../../ARCHITECTURE.md) § 9) — the hash is the route,
   `TeamView` plus `useState` is the state, and the wheel animations are
   hand-rolled components.

A new dependency is a new supply-chain surface, a new thing `pnpm audit`
and the Trivy scan in CI have to clear, and a new thing to keep
`node:26-alpine`-compatible. If you believe one is genuinely warranted,
say why in the PR description — "it was faster to add" is not a reason
that survives review here.

## § 5 Commit and PR expectations

Run `pnpm verify` before opening a PR. CI additionally runs `pnpm audit`,
an E2E pass, a container build with a health-check smoke test, a Trivy
vulnerability scan, and SBOM generation (`.github/workflows/ci.yml`) — a PR
is not mergeable green until all of that passes, not just `verify`.
