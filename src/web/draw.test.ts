import { describe, expect, it } from 'vitest';
import type { SpinView } from '../domain/views.ts';
import { ApiError } from './apiError.ts';
import { performDraw } from './draw.ts';

const spin = (spinId: string, revealed: boolean): SpinView =>
  ({
    spinId,
    poolId: null,
    nonce: 1,
    commitment: 'c',
    participants: [],
    modifiers: [],
    committedAt: '',
    reveal: revealed
      ? { clientSeed: 's', digest: 'd', selectedMemberId: 'm1', revealedAt: '', serverSeed: 'x' }
      : null,
    appeal: null,
  }) as unknown as SpinView;

const seedFor = () => 'seed';

describe('performDraw', () => {
  it('commits and reveals a fresh spin', async () => {
    const calls: string[] = [];
    const api = {
      commitSpin: async (_t: string, spinId: string) => {
        calls.push(`commit:${spinId}`);
        return spin(spinId, false);
      },
      revealSpin: async (_t: string, spinId: string) => {
        calls.push(`reveal:${spinId}`);
        return spin(spinId, true);
      },
      getTeam: async () => {
        throw new Error('not needed');
      },
    };
    const result = await performDraw(api, 't1', null, undefined, seedFor);
    expect(result.reveal).not.toBeNull();
    expect(calls[0]).toMatch(/^commit:/);
    expect(calls[1]?.slice(7)).toBe(calls[0]?.slice(7)); // reveals the committed spin
  });

  it('finishes the already-open spin when the commit 409s', async () => {
    const api = {
      commitSpin: async () => {
        throw new ApiError(409, 'läuft schon', { spinId: 'open-1' });
      },
      revealSpin: async (_t: string, spinId: string) => spin(spinId, true),
      getTeam: async () => {
        throw new Error('not needed');
      },
    };
    const result = await performDraw(api, 't1', null, undefined, seedFor);
    expect(result.spinId).toBe('open-1');
  });

  it('adopts the persisted result when another browser revealed first', async () => {
    // The team is fetched fresh; the spin we committed shows up revealed there.
    let committed = '';
    const api = {
      commitSpin: async (_t: string, spinId: string) => {
        committed = spinId;
        return spin(spinId, false);
      },
      revealSpin: async () => {
        throw new ApiError(409, 'schon aufgedeckt', {});
      },
      getTeam: async () => ({ spins: [spin(committed, true)] }) as unknown,
    };
    const result = await performDraw(
      api as Parameters<typeof performDraw>[0],
      't1',
      null,
      undefined,
      seedFor,
    );
    expect(result.spinId).toBe(committed);
    expect(result.reveal).not.toBeNull();
  });

  it('rethrows a reveal 409 when no persisted result exists', async () => {
    const api = {
      commitSpin: async (_t: string, spinId: string) => spin(spinId, false),
      revealSpin: async () => {
        throw new ApiError(409, 'Konflikt', {});
      },
      getTeam: async () => ({ spins: [] }) as unknown,
    };
    await expect(
      performDraw(api as Parameters<typeof performDraw>[0], 't1', null, undefined, seedFor),
    ).rejects.toMatchObject({ status: 409 });
  });
});
