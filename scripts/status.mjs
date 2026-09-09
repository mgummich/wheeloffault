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

function run(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function firstMatch(out, re, fallback = 'unknown') {
  const m = out.match(re);
  return m ? m[1] : fallback;
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

const results = checks.map(({ name, cmd, details }) => {
  const { ok, out } = run(cmd);
  return { name: `${name} (${cmd})`, status: ok ? 'pass' : 'fail', details: details(out) };
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
