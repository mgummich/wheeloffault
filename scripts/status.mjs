#!/usr/bin/env node
// Regenerates docs/STATUS.json by actually running the checks, so the file
// cannot drift from reality the way a hand-maintained report did (stale at
// three consecutive reviews, then stale again one commit after being
// hand-written a fourth time). Each entry's "details" is a deterministic
// summary derived from the command's own output — counts only, never a
// timing, date, or environment fingerprint — so `git diff --exit-code
// docs/STATUS.json` after a fresh run is a valid CI gate: rerunning the
// exact same code produces byte-identical JSON.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

// Colour is stripped because the patterns below match across the whitespace
// in lines like "Test Files  24 passed": when a tool decides to colourise
// (vitest does inside CI's Playwright container, but not on a bare runner)
// the escape sequences land in the middle of those matches and every
// extraction throws.
function run(cmd) {
  try {
    return {
      ok: true,
      out: stripVTControlCharacters(execSync(cmd, { encoding: 'utf8', stdio: 'pipe' })),
    };
  } catch (err) {
    return { ok: false, out: stripVTControlCharacters(`${err.stdout ?? ''}${err.stderr ?? ''}`) };
  }
}

// No silent 'unknown' fallback: a record this script writes is a CI gate
// (see the file header), so if a command's output no longer matches the
// pattern we expect (a biome/vitest/vite wording change), that must fail
// the script loudly rather than let a meaningless "unknown" get committed
// and stay green forever. `fallback` is only for cases where a missing
// match is itself meaningful, not a broken extraction (e.g. lint printing
// no "Found N warnings" line when there are zero).
function firstMatch(out, re, fallback) {
  const m = out.match(re);
  if (m) return m[1];
  if (fallback !== undefined) return fallback;
  throw new Error(`status.mjs: pattern ${re} did not match output:\n${out.slice(0, 2000)}`);
}

const checks = [
  {
    name: 'format:check',
    cmd: 'pnpm format:check',
    details: (out) => `Checked ${firstMatch(out, /Checked (\d+) files/)} files.`,
  },
  {
    name: 'lint',
    cmd: 'pnpm lint',
    details: (out) =>
      `Checked ${firstMatch(out, /Checked (\d+) files/)} files. Found ${firstMatch(out, /Found (\d+) warnings?/, '0')} warnings.`,
  },
  {
    name: 'typecheck',
    cmd: 'pnpm typecheck',
    details: (out) => (out.trim() ? 'Errors found.' : 'No errors.'),
  },
  {
    name: 'test:unit',
    cmd: 'pnpm test:unit',
    details: (out) =>
      `${firstMatch(out, /Test Files\s+(\d+) passed/)} test files, ${firstMatch(out, /Tests\s+(\d+) passed/)} tests passed.`,
  },
  {
    name: 'test:integration',
    cmd: 'pnpm test:integration',
    details: (out) =>
      `${firstMatch(out, /Test Files\s+(\d+) passed/)} test files, ${firstMatch(out, /Tests\s+(\d+) passed/)} tests passed.`,
  },
  {
    name: 'build',
    cmd: 'pnpm build',
    details: (out) => {
      const modules = firstMatch(out, /✓ (\d+) modules transformed/);
      const docs = (out.match(/^docs: .+ → /gm) ?? []).length;
      return `${modules} modules transformed; ${docs} docs rendered without a symbol-guard or completeness failure.`;
    },
  },
  {
    name: 'build:server',
    cmd: 'pnpm build:server',
    details: (out) => `${firstMatch(out, /✓ (\d+) modules transformed/)} modules transformed.`,
  },
  {
    name: 'e2e',
    cmd: 'pnpm e2e',
    details: (out) => `${firstMatch(out, /(\d+) passed/)} tests passed.`,
  },
];

// Only extract counts from output we expect to have the normal shape
// (a passing run). A failing run's output isn't worth pattern-matching —
// details() would either throw on it via firstMatch or, worse, "succeed"
// with a number that doesn't mean what it usually means.
const results = checks.map(({ name, cmd, details }) => {
  const { ok, out } = run(cmd);
  return {
    name: `${name} (${cmd})`,
    status: ok ? 'pass' : 'fail',
    details: ok ? details(out) : 'Failed.',
  };
});

const status = { checks: results };

writeFileSync(
  new URL('../docs/STATUS.json', import.meta.url),
  `${JSON.stringify(status, null, 2)}\n`,
);
console.log(
  `docs/STATUS.json written: ${results.filter((r) => r.status === 'pass').length}/${results.length} pass`,
);
if (results.some((r) => r.status !== 'pass')) process.exitCode = 1;
