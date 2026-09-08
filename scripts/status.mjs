#!/usr/bin/env node
// Regenerates docs/STATUS.json by actually running the checks, so the file
// cannot drift from reality the way a hand-maintained report did (stale at
// three consecutive reviews before this script existed). Each entry's
// "details" is derived from the command's own output, not typed by hand.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const checks = [
  ['format:check', 'pnpm format:check'],
  ['lint', 'pnpm lint'],
  ['typecheck', 'pnpm typecheck'],
  ['test:unit', 'pnpm test:unit'],
  ['test:integration', 'pnpm test:integration'],
  ['build', 'pnpm build'],
  ['build:server', 'pnpm build:server'],
  ['e2e', 'pnpm e2e'],
];

function lastMeaningfulLine(output) {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 200) : '(no output)';
}

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return { status: 'pass', details: lastMeaningfulLine(out) };
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    return { status: 'fail', details: lastMeaningfulLine(out) };
  }
}

const results = checks.map(([name, cmd]) => ({ name: `${name} (${cmd})`, ...run(cmd) }));

const status = {
  date: new Date().toISOString().slice(0, 10),
  branch: execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim(),
  environment: {
    node: process.version,
    pnpm: execSync('pnpm --version', { encoding: 'utf8' }).trim(),
    os: `${process.platform} (${execSync('uname -sr', { encoding: 'utf8' }).trim()})`,
  },
  checks: results,
};

writeFileSync(
  new URL('../docs/STATUS.json', import.meta.url),
  `${JSON.stringify(status, null, 2)}\n`,
);
console.log(
  `docs/STATUS.json written: ${results.filter((r) => r.status === 'pass').length}/${results.length} pass`,
);
if (results.some((r) => r.status !== 'pass')) process.exitCode = 1;
