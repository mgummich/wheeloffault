import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as eventsModule from '../domain/events.ts';
import type { SpinView } from '../domain/views.ts';
import { createSessionApi } from './sessionApi.ts';

vi.mock('../domain/events.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../domain/events.ts')>();
  return { ...actual, upcast: vi.fn(actual.upcast) };
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  };
}

describe('session api', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('persists teams and members across api instances backed by the same session storage', async () => {
    const first = createSessionApi(storage);
    const team = await first.createTeam('Team Reload');
    await first.addMembers(team.teamId, ['Anna', 'Bob']);

    const afterReload = createSessionApi(storage);
    const restored = await afterReload.getTeam(team.teamId);

    expect(restored.name).toBe('Team Reload');
    expect(restored.members.map((member) => member.name)).toEqual(['Anna', 'Bob']);
    expect(await afterReload.listTeams()).toEqual([
      {
        teamId: team.teamId,
        name: 'Team Reload',
        memberCount: 2,
        spinCount: 0,
      },
    ]);
  });

  it('runs every stored event through upcast when reading a team back', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Upcast');
    await api.addMembers(team.teamId, ['Anna']);

    const upcastSpy = vi.mocked(eventsModule.upcast);
    upcastSpy.mockClear();

    await createSessionApi(storage).getTeam(team.teamId);

    // TeamCreated + MemberJoined must each pass through the upcast seam on load,
    // the same as the server-side event stores (eventStore.ts / postgresEventStore.ts).
    expect(upcastSpy.mock.calls.map(([event]) => event.type)).toEqual([
      'TeamCreated',
      'MemberJoined',
    ]);
  });

  it('commits and reveals a verifiable spin without leaking the seed before reveal', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Rad');
    await api.addMembers(team.teamId, ['Anna', 'Bob']);

    const committed = await api.commitSpin(team.teamId, 'spin-1', null);
    expect(committed.reveal).toBeNull();
    expect(JSON.stringify(committed)).not.toContain('serverSeed');

    const pending = await api.getTeam(team.teamId);
    expect(pending.pendingSpin?.spinId).toBe('spin-1');
    expect(JSON.stringify(pending)).not.toContain('serverSeed');

    const revealed = await api.revealSpin(team.teamId, 'spin-1', 'client-seed');
    expect(revealed.reveal?.serverSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(revealed.reveal?.selectedMemberId).toBeTruthy();

    const restored = await createSessionApi(storage).getTeam(team.teamId);
    expect(restored.pendingSpin).toBeNull();
    expect(restored.statistics.totalSpins).toBe(1);
  });

  it('returns a conflict with the pending spin id when a second spin starts before reveal', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Konflikt');
    await api.addMembers(team.teamId, ['Anna', 'Bob']);
    await api.commitSpin(team.teamId, 'spin-1', null);

    await expect(api.commitSpin(team.teamId, 'spin-2', null)).rejects.toMatchObject({
      status: 409,
      body: { spinId: 'spin-1' },
    });
  });

  it('keeps reveal idempotent for the same client seed', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Retry');
    await api.addMembers(team.teamId, ['Anna', 'Bob']);
    await api.commitSpin(team.teamId, 'spin-1', null);

    const first = await api.revealSpin(team.teamId, 'spin-1', 'same');
    const second = await api.revealSpin(team.teamId, 'spin-1', 'same');
    expect(second).toEqual(first);

    await expect(api.revealSpin(team.teamId, 'spin-1', 'different')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('supports the remaining team commands from session storage', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Befehle');
    const withMembers = await api.addMembers(team.teamId, ['Anna', 'Bob']);
    const anna = withMembers.members[0];
    const bob = withMembers.members[1];
    if (!anna || !bob) throw new Error('missing members');

    const pool = await api.createPool(team.teamId, 'Daily', [anna.memberId]);
    const poolId = pool.pools[0]?.poolId ?? '';
    await api.changePoolMembers(team.teamId, poolId, [anna.memberId, bob.memberId]);
    await api.grantImmunity(team.teamId, anna.memberId, 'Fahrgastrecht');
    await api.deactivateMember(team.teamId, bob.memberId);
    await api.reactivateMember(team.teamId, bob.memberId);
    await api.changePolicy(team.teamId, {
      ...pool.policy,
      pity: { ...pool.policy.pity, enabled: true, percentPerSpin: 25 },
    });
    await api.commitSpin(team.teamId, 'spin-1', null);
    const spin = (await api.revealSpin(team.teamId, 'spin-1', 'appeal')) as SpinView;
    await api.appeal(team.teamId, spin.spinId, 'War nicht da');
    await api.decideAppeal(team.teamId, spin.spinId, 'uphold');

    const restored = await createSessionApi(storage).getTeam(team.teamId);
    expect(restored.pools[0]?.memberIds).toEqual([anna.memberId, bob.memberId]);
    expect(restored.policy.pity.enabled).toBe(true);
    expect(restored.statistics.overturnedSpins).toBe(1);
    expect((await api.memberReport(team.teamId, anna.memberId)).memberId).toBe(anna.memberId);
  });

  it('rejects a malformed policy in static mode and never persists it', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Policy');

    await expect(
      api.changePolicy(team.teamId, {
        ...team.policy,
        pity: { ...team.policy.pity, enabled: true, percentPerSpin: 0.5 },
      }),
    ).rejects.toMatchObject({ status: 400, body: { code: 'policy_invalid' } });

    const restored = await createSessionApi(storage).getTeam(team.teamId);
    expect(restored.policy.pity.percentPerSpin).toBe(team.policy.pity.percentPerSpin);
  });

  it('rejects an over-long or NUL-containing member name in static mode and never persists it', async () => {
    const api = createSessionApi(storage);
    const team = await api.createTeam('Team Names');

    await expect(api.addMembers(team.teamId, ['x'.repeat(61)])).rejects.toMatchObject({
      status: 400,
    });
    await expect(api.addMembers(team.teamId, ['Anna\u0000'])).rejects.toMatchObject({
      status: 400,
    });

    const restored = await createSessionApi(storage).getTeam(team.teamId);
    expect(restored.members).toEqual([]);
  });
});
