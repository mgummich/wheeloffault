import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  commitmentOf,
  drawMessage,
  hmacSha256Hex,
  selectParticipant,
  verifySpin,
} from './draw.ts';

const seed = 'aa'.repeat(32);

describe('canonicalJson', () => {
  it('sorts keys recursively and keeps arrays ordered', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe('selectParticipant', () => {
  const two = [
    { memberId: 'a', weight: 1000 },
    { memberId: 'b', weight: 1000 },
  ];

  it('is deterministic for the same digest', () => {
    const d = '0000000000000001ffff';
    expect(selectParticipant(d, two)).toBe(selectParticipant(d, two));
  });

  it('picks by position on the cumulative weight line (known vectors)', () => {
    // point = uint64(first 16 hex) mod 2000
    expect(selectParticipant('0000000000000000', two)).toBe('a');
    expect(selectParticipant('00000000000003e7', two)).toBe('a'); // 999
    expect(selectParticipant('00000000000003e8', two)).toBe('b'); // 1000
    expect(selectParticipant('00000000000007cf', two)).toBe('b'); // 1999
    expect(selectParticipant('00000000000007d0', two)).toBe('a'); // 2000 mod 2000 = 0
  });

  it('ignores participant order', () => {
    const reversed = [...two].reverse();
    expect(selectParticipant('00000000000003e8', reversed)).toBe('b');
  });

  it('never selects a zero-weight participant', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ memberId: fc.uuid(), weight: fc.integer({ min: 0, max: 5000 }) }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 64, maxLength: 64 }),
        (participants, digest) => {
          fc.pre(participants.some((p) => p.weight > 0));
          const chosen = selectParticipant(digest, participants);
          const p = participants.find((x) => x.memberId === chosen);
          expect(p?.weight).toBeGreaterThan(0);
        },
      ),
    );
  });

  it('rejects all-zero, negative and non-integer weights', () => {
    expect(() => selectParticipant('00', [{ memberId: 'a', weight: 0 }])).toThrow(/Gewichte/);
    expect(() => selectParticipant('00', [{ memberId: 'a', weight: -1 }])).toThrow(/Ungültig/);
    expect(() => selectParticipant('00', [{ memberId: 'a', weight: 1.5 }])).toThrow(/Ungültig/);
    expect(() => selectParticipant('00', [{ memberId: 'a', weight: Number.NaN }])).toThrow();
    expect(() => selectParticipant('00', [])).toThrow(/Keine/);
  });
});

describe('commit/reveal', () => {
  const participants = [
    { memberId: 'm1', weight: 1000 },
    { memberId: 'm2', weight: 2000 },
  ];

  it('produces a known HMAC for a known seed (vector pins the protocol)', async () => {
    const digest = await hmacSha256Hex(seed, 'hello');
    expect(digest).toHaveLength(64);
    // Independently computed with node:crypto
    const { createHmac } = await import('node:crypto');
    expect(digest).toBe(
      createHmac('sha256', Buffer.from(seed, 'hex')).update('hello').digest('hex'),
    );
  });

  it('commitment binds seed, nonce and every weight', async () => {
    const c = await commitmentOf(seed, 1, participants);
    expect(await commitmentOf(seed, 1, [...participants].reverse())).toBe(c);
    expect(await commitmentOf(seed, 2, participants)).not.toBe(c);
    expect(await commitmentOf('bb'.repeat(32), 1, participants)).not.toBe(c);
    expect(
      await commitmentOf(seed, 1, [participants[0] as never, { memberId: 'm2', weight: 2001 }]),
    ).not.toBe(c);
  });

  it('verifySpin reproduces a well-formed proof and detects tampering', async () => {
    const nonce = 7;
    const clientSeed = 'client-123';
    const commitment = await commitmentOf(seed, nonce, participants);
    const digest = await hmacSha256Hex(seed, drawMessage(commitment, clientSeed, nonce));
    const selectedMemberId = selectParticipant(digest, participants);
    const proof = {
      nonce,
      commitment,
      participants,
      serverSeed: seed,
      clientSeed,
      digest,
      selectedMemberId,
    };
    expect((await verifySpin(proof)).ok).toBe(true);

    const other = participants.find((p) => p.memberId !== selectedMemberId)?.memberId ?? '';
    expect(await verifySpin({ ...proof, selectedMemberId: other })).toMatchObject({
      selectionMatches: false,
      ok: false,
    });
    expect(await verifySpin({ ...proof, serverSeed: 'cc'.repeat(32) })).toMatchObject({
      commitmentMatches: false,
      ok: false,
    });
    expect(await verifySpin({ ...proof, clientSeed: 'x' })).toMatchObject({ ok: false });
  });

  it('same inputs give the same result; different client seeds spread the outcomes', async () => {
    const commitment = await commitmentOf(seed, 1, participants);
    const chosen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const d1 = await hmacSha256Hex(seed, drawMessage(commitment, `c${i}`, 1));
      const d2 = await hmacSha256Hex(seed, drawMessage(commitment, `c${i}`, 1));
      expect(d1).toBe(d2);
      chosen.add(selectParticipant(d1, participants));
    }
    expect(chosen.size).toBe(2);
  });
});
