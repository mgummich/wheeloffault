import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  commitmentOf,
  drawMessage,
  hmacSha256Hex,
  selectParticipant,
} from './draw.ts';

/**
 * Frozen known-answer vectors: hard-coded expected hex, not recomputed by the
 * code under test. Constants were generated once by running commitmentOf /
 * hmacSha256Hex / selectParticipant against the inputs below and inlining
 * the output. If one of these ever changes, the fairness protocol's output
 * changed — that must never happen silently.
 */

describe('canonicalJson (pinned)', () => {
  it('matches a frozen output string', () => {
    const value = {
      b: 1,
      a: [1, 2, { z: 'ü', a: 'x' }],
      serverSeed: 'seed',
      nonce: 3,
      participants: [
        { memberId: 'b', weight: 1 },
        { memberId: 'a', weight: 2 },
      ],
    };
    expect(canonicalJson(value)).toBe(
      '{"a":[1,2,{"a":"x","z":"ü"}],"b":1,"nonce":3,"participants":[{"memberId":"b","weight":1},{"memberId":"a","weight":2}],"serverSeed":"seed"}',
    );
  });
});

describe('end-to-end draw vectors (pinned)', () => {
  it('ASCII participants', async () => {
    const serverSeed =
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00';
    const clientSeed = 'clientseed-ascii-001';
    const nonce = 0;
    const participants = [
      { memberId: 'alice', weight: 1000 },
      { memberId: 'bob', weight: 2000 },
      { memberId: 'carol', weight: 3000 },
    ];

    const commitment = await commitmentOf(serverSeed, nonce, participants);
    expect(commitment).toBe('3301636c4a88aceff5509db7a53b78412bbd317b34a90e20f0a91647e26cd432');

    const digest = await hmacSha256Hex(serverSeed, drawMessage(commitment, clientSeed, nonce));
    expect(digest).toBe('a4e6e6292b2b3c4253f6d40f8a5924ae61f419936efa9fcae5e79af3cda0a060');

    expect(selectParticipant(digest, participants)).toBe('bob');
  });

  it('non-ASCII / Unicode participant names and seeds', async () => {
    const serverSeed =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566';
    const clientSeed = 'клиент-seed-üñîçødé-🎉';
    const nonce = 7;
    const participants = [
      { memberId: 'müller-jörg', weight: 500 },
      { memberId: '田中太郎', weight: 1500 },
      { memberId: 'zoë-💥', weight: 1000 },
    ];

    const commitment = await commitmentOf(serverSeed, nonce, participants);
    expect(commitment).toBe('b92b06fedf39ee349a9494981fb81f656bc6dd46faa06513b0e2d9d707ebe562');

    const digest = await hmacSha256Hex(serverSeed, drawMessage(commitment, clientSeed, nonce));
    expect(digest).toBe('40200b61ce4b70d89e1897b2a7f186732eb73e24513062118590ea9b4932003e');

    expect(selectParticipant(digest, participants)).toBe('田中太郎');
  });
});
