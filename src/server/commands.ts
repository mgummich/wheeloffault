import { randomUUID } from 'node:crypto';
import * as decide from '../domain/decisions.ts';
import { DomainError } from '../domain/errors.ts';
import type { DomainEvent, StoredEvent } from '../domain/events.ts';
import { randomHex } from '../domain/fairness/draw.ts';
import type { FairnessPolicy } from '../domain/fairness/policy.ts';
import { commitSpin, revealSpin } from '../domain/fairness/spin.ts';
import { type TeamState, findSpin, replay } from '../domain/team.ts';
import { ConcurrencyError, type EventStore } from './eventStore.ts';

/**
 * Application layer: load stream → decide → append, with optimistic
 * concurrency and a bounded retry. Every public function here is one HTTP
 * command. Nothing in this file knows about HTTP.
 */

export type Commands = ReturnType<typeof createCommands>;

export function createCommands(
  store: EventStore,
  onAppended: (teamId: string, events: StoredEvent[]) => void = () => {},
) {
  const now = () => new Date().toISOString();

  async function loadTeam(teamId: string): Promise<TeamState> {
    const events = await store.load(teamId);
    if (events.length === 0) throw new DomainError(`Team ${teamId} unbekannt`, 'not_found');
    return replay(events);
  }

  /**
   * Runs `decision` against the freshest state and appends the result. If
   * someone else appended in between, the decision is re-evaluated against
   * the new state, at most three times. Decisions must therefore be pure.
   */
  async function execute(
    teamId: string,
    decision: (state: TeamState) => DomainEvent[] | Promise<DomainEvent[]>,
  ): Promise<TeamState> {
    for (let attempt = 0; ; attempt++) {
      const state = await loadTeam(teamId);
      const events = await decision(state);
      try {
        const stored = await store.append(teamId, state.version, events);
        if (stored.length > 0) onAppended(teamId, stored);
        return replay(events, state);
      } catch (err) {
        if (!(err instanceof ConcurrencyError) || attempt >= 2) throw err;
      }
    }
  }

  return {
    loadTeam,

    async listTeams(): Promise<TeamState[]> {
      const ids = await store.streamsWithEvent('TeamCreated');
      return Promise.all(ids.map(async (id) => replay(await store.load(id))));
    },

    async createTeam(name: string): Promise<TeamState> {
      const teamId = randomUUID();
      const events = decide.createTeam(teamId, name, now());
      const stored = await store.append(teamId, 0, events);
      onAppended(teamId, stored);
      return replay(events);
    },

    addMembers: (teamId: string, names: string[]) =>
      execute(teamId, (s) => decide.addMembers(s, names, randomUUID, now())),

    deactivateMember: (teamId: string, memberId: string) =>
      execute(teamId, (s) => decide.deactivateMember(s, memberId, now())),

    reactivateMember: (teamId: string, memberId: string) =>
      execute(teamId, (s) => decide.reactivateMember(s, memberId, now())),

    grantImmunity: (teamId: string, memberId: string, reason: string) =>
      execute(teamId, (s) => decide.grantImmunity(s, memberId, reason, now())),

    changePolicy: (teamId: string, policy: FairnessPolicy) =>
      execute(teamId, (s) => decide.changePolicy(s, policy, now())),

    createPool: (teamId: string, name: string, memberIds: string[]) =>
      execute(teamId, (s) => decide.createPool(s, randomUUID(), name, memberIds, now())),

    changePoolMembers: (teamId: string, poolId: string, memberIds: string[]) =>
      execute(teamId, (s) => decide.changePoolMembers(s, poolId, memberIds, now())),

    /** Commit step. A fresh server seed per attempt; the persisted one wins. */
    async commitSpin(teamId: string, spinId: string, poolId: string | null) {
      const state = await execute(teamId, async (s) => {
        const result = await commitSpin(s, {
          spinId,
          poolId,
          serverSeed: randomHex(32),
          now: now(),
        });
        return result.events;
      });
      return { state, spin: findSpin(state, spinId) };
    },

    async revealSpin(teamId: string, spinId: string, clientSeed: string) {
      const state = await execute(teamId, (s) => revealSpin(s, { spinId, clientSeed, now: now() }));
      return { state, spin: findSpin(state, spinId) };
    },

    appealGuilt: (teamId: string, spinId: string, reason: string) =>
      execute(teamId, (s) => decide.appealGuilt(s, spinId, reason, now())),

    decideAppeal: (teamId: string, spinId: string, outcome: 'upheld' | 'rejected') =>
      execute(teamId, (s) => decide.decideAppeal(s, spinId, outcome, now())),
  };
}
