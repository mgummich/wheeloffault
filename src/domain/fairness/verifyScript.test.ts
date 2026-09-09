import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Spawns scripts/verify-draw.mjs against the same frozen vector used in
 * vectors.test.ts. This is the standalone verifier — it does not import
 * draw.ts — so this test is the only thing that keeps it honest against
 * the real protocol.
 */

const scriptPath = fileURLToPath(new URL('../../../scripts/verify-draw.mjs', import.meta.url));

const vector = {
  serverSeed: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
  clientSeed: 'clientseed-ascii-001',
  nonce: 0,
  participants: [
    { memberId: 'alice', weight: 1000 },
    { memberId: 'bob', weight: 2000 },
    { memberId: 'carol', weight: 3000 },
  ],
  commitment: '3301636c4a88aceff5509db7a53b78412bbd317b34a90e20f0a91647e26cd432',
  digest: 'a4e6e6292b2b3c4253f6d40f8a5924ae61f419936efa9fcae5e79af3cda0a060',
  selectedMemberId: 'bob',
};

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function runWith(data: unknown) {
  dir = mkdtempSync(join(tmpdir(), 'verify-draw-'));
  const file = join(dir, 'draw.json');
  writeFileSync(file, JSON.stringify(data));
  return spawnSync(process.execPath, [scriptPath, '--file', file], { encoding: 'utf8' });
}

describe('scripts/verify-draw.mjs', () => {
  it('exits 0 and prints a PASS verdict for a valid, frozen vector', () => {
    const result = runWith(vector);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PRÜFPROTOKOLL');
    expect(result.stdout).toContain('bestanden');
  });

  it('exits 1 when the selected member is tampered with', () => {
    const result = runWith({ ...vector, selectedMemberId: 'alice' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('beanstandet');
  });

  it('exits 1 when the commitment is tampered with', () => {
    const result = runWith({ ...vector, commitment: `${vector.commitment.slice(0, -1)}0` });
    expect(result.status).toBe(1);
  });

  it('exits 1 when a weight is tampered with', () => {
    const result = runWith({
      ...vector,
      participants: [
        { memberId: 'alice', weight: 999 },
        { memberId: 'bob', weight: 2000 },
        { memberId: 'carol', weight: 3000 },
      ],
    });
    expect(result.status).toBe(1);
  });

  it('exits 1 for a duplicate memberId (mirrors draw.ts, which also rejects this)', () => {
    // This record's commitment/digest are recomputed FOR this exact duplicate
    // participant list (see scripts/compute-dup-vector notes below), and
    // selectedMemberId is the value the verifier's own selection math would
    // produce for it if the duplicate/weight check were skipped. So the
    // commitment and digest checks pass regardless, and the only thing that
    // can make this fail is the duplicate-memberId guard in
    // assertValidWeights (scripts/verify-draw.mjs). Deleting that guard makes
    // this test go from exit 1 to exit 0 — unlike the old version of this
    // test, which used the frozen `vector`'s commitment/digest unchanged, so
    // editing `participants` always tripped the commitment check first and
    // the duplicate guard was never actually exercised.
    const dupVector = {
      serverSeed: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00',
      clientSeed: 'clientseed-ascii-001',
      nonce: 0,
      participants: [
        { memberId: 'alice', weight: 1000 },
        { memberId: 'alice', weight: 2000 },
        { memberId: 'carol', weight: 3000 },
      ],
      commitment: 'b9ada65509852a5eb7f05071d3f5a73de71f185e138461561a8c34976b567f14',
      digest: 'c2ef716a197f7ed3d1b4237bae9f9c6e9d0e6c842a4a82e576bd197004173988',
      selectedMemberId: 'alice',
    };
    const result = runWith(dupVector);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('duplicate memberId');
  });

  it('exits 2 (usage error) when a required field is missing', () => {
    const { selectedMemberId: _omit, ...withoutSelected } = vector;
    const result = runWith(withoutSelected);
    expect(result.status).toBe(2);
  });

  it('exits 2 (usage error) when nonce is not a non-negative integer', () => {
    const result = runWith({ ...vector, nonce: -1 });
    expect(result.status).toBe(2);
  });

  it('accepts a leading bare "--" (what `pnpm verify:draw -- --file draw.json` actually forwards)', () => {
    // pnpm 11 forwards the literal "--" instead of consuming it, so the
    // documented invocation (docs/en+de/fairness.md § 8) passes the script
    // ['--', '--file', <path>] rather than ['--file', <path>]. This is the
    // exact argv shape that produced, without the parser skipping "--":
    // "unknown flag --", exit 2 — the documented command never ran.
    dir = mkdtempSync(join(tmpdir(), 'verify-draw-'));
    const file = join(dir, 'draw.json');
    writeFileSync(file, JSON.stringify(vector));
    const result = spawnSync(process.execPath, [scriptPath, '--', '--file', file], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bestanden');
  });
});
