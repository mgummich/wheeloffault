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

  it('accepts the same vector via flag mode (--server-seed and friends) and passes', () => {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--server-seed',
        vector.serverSeed,
        '--client-seed',
        vector.clientSeed,
        '--nonce',
        String(vector.nonce),
        '--participants',
        JSON.stringify(vector.participants),
        '--commitment',
        vector.commitment,
        '--digest',
        vector.digest,
        '--selected-member-id',
        vector.selectedMemberId,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bestanden');
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
});
