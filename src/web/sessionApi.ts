import * as decide from '../domain/decisions.ts';
import { DomainError } from '../domain/errors.ts';
import type { DomainEvent, StoredEvent } from '../domain/events.ts';
import { randomHex } from '../domain/fairness/draw.ts';
import type { FairnessPolicy } from '../domain/fairness/policy.ts';
import {
  commitSpin as decideCommitSpin,
  revealSpin as decideRevealSpin,
} from '../domain/fairness/spin.ts';
import { memberReport } from '../domain/projections/report.ts';
import { findSpin, replay, type TeamState } from '../domain/team.ts';
import {
  type SpinView,
  spinView,
  type TeamListEntry,
  type TeamView,
  teamView,
} from '../server/views.ts';
import { ApiError } from './apiError.ts';
import type { Api } from './serverApi.ts';

const STORAGE_KEY = 'schuldrad.sessionEvents.v1';

type SessionData = {
  nextPosition: number;
  events: StoredEvent[];
};

export function createSessionApi(storage: Storage = localStorage): Api {
  const read = (): SessionData => {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { nextPosition: 1, events: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<SessionData>;
      const nextPosition = parsed.nextPosition;
      return {
        nextPosition:
          typeof nextPosition === 'number' && Number.isSafeInteger(nextPosition) ? nextPosition : 1,
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return { nextPosition: 1, events: [] };
    }
  };

  const write = (data: SessionData) => storage.setItem(STORAGE_KEY, JSON.stringify(data));

  const stream = (teamId: string): StoredEvent[] =>
    read()
      .events.filter((event) => event.streamId === teamId)
      .sort((a, b) => a.version - b.version);

  const loadTeam = (teamId: string): TeamState => {
    const events = stream(teamId);
    if (events.length === 0) throw new DomainError(`Team ${teamId} unbekannt`, 'not_found');
    return replay(events);
  };

  const append = (teamId: string, expectedVersion: number, events: DomainEvent[]) => {
    if (events.length === 0) return [];
    const data = read();
    const currentVersion = data.events.filter((event) => event.streamId === teamId).length;
    if (currentVersion !== expectedVersion) {
      throw new DomainError(
        `Team ${teamId} wurde seit Version ${expectedVersion} verändert`,
        'conflict',
      );
    }
    const stored = events.map((event, index) => ({
      ...event,
      streamId: teamId,
      version: expectedVersion + index + 1,
      position: data.nextPosition + index,
    }));
    write({
      nextPosition: data.nextPosition + stored.length,
      events: [...data.events, ...stored],
    });
    return stored;
  };

  const execute = async (
    teamId: string,
    decision: (state: TeamState) => DomainEvent[] | Promise<DomainEvent[]>,
  ): Promise<TeamView> => {
    try {
      const state = loadTeam(teamId);
      const events = await decision(state);
      append(teamId, state.version, events);
      return teamView(replay(events, state));
    } catch (err) {
      throw toApiError(err);
    }
  };

  return {
    async listTeams(): Promise<TeamListEntry[]> {
      try {
        const data = read();
        const teamIds = [
          ...new Set(
            data.events
              .filter((event) => event.type === 'TeamCreated')
              .sort((a, b) => a.position - b.position)
              .map((event) => event.streamId),
          ),
        ];
        return teamIds.map((teamId) => {
          const state = replay(stream(teamId));
          return {
            teamId: state.teamId,
            name: state.name,
            memberCount: state.members.filter((member) => member.active).length,
            spinCount: state.spins.filter((spin) => spin.reveal).length,
          };
        });
      } catch (err) {
        throw toApiError(err);
      }
    },

    async createTeam(name: string): Promise<TeamView> {
      try {
        const teamId = crypto.randomUUID();
        const events = decide.createTeam(teamId, name, now());
        append(teamId, 0, events);
        return teamView(replay(events));
      } catch (err) {
        throw toApiError(err);
      }
    },

    async getTeam(teamId: string): Promise<TeamView> {
      try {
        return teamView(loadTeam(teamId));
      } catch (err) {
        throw toApiError(err);
      }
    },

    addMembers: (teamId: string, names: string[]) =>
      execute(teamId, (state) => decide.addMembers(state, names, () => crypto.randomUUID(), now())),

    deactivateMember: (teamId: string, memberId: string) =>
      execute(teamId, (state) => decide.deactivateMember(state, memberId, now())),

    reactivateMember: (teamId: string, memberId: string) =>
      execute(teamId, (state) => decide.reactivateMember(state, memberId, now())),

    grantImmunity: (teamId: string, memberId: string, reason: string) =>
      execute(teamId, (state) => decide.grantImmunity(state, memberId, reason, now())),

    revokeImmunity: (teamId: string, memberId: string) =>
      execute(teamId, (state) => decide.revokeImmunity(state, memberId, now())),

    changePolicy: (teamId: string, policy: FairnessPolicy) =>
      execute(teamId, (state) => decide.changePolicy(state, policy, now())),

    createPool: (teamId: string, name: string, memberIds: string[]) =>
      execute(teamId, (state) =>
        decide.createPool(state, crypto.randomUUID(), name, memberIds, now()),
      ),

    changePoolMembers: (teamId: string, poolId: string, memberIds: string[]) =>
      execute(teamId, (state) => decide.changePoolMembers(state, poolId, memberIds, now())),

    renamePool: (teamId: string, poolId: string, name: string) =>
      execute(teamId, (state) => decide.renamePool(state, poolId, name, now())),

    deletePool: (teamId: string, poolId: string) =>
      execute(teamId, (state) => decide.deletePool(state, poolId, now())),

    async commitSpin(teamId: string, spinId: string, poolId: string | null): Promise<SpinView> {
      try {
        const state = loadTeam(teamId);
        const result = await decideCommitSpin(state, {
          spinId,
          poolId,
          serverSeed: randomHex(32),
          now: now(),
        });
        append(teamId, state.version, result.events);
        return spinView(findSpin(replay(result.events, state), spinId));
      } catch (err) {
        throw toApiError(err);
      }
    },

    async revealSpin(teamId: string, spinId: string, clientSeed: string): Promise<SpinView> {
      try {
        const state = loadTeam(teamId);
        const events = await decideRevealSpin(state, { spinId, clientSeed, now: now() });
        append(teamId, state.version, events);
        return spinView(findSpin(replay(events, state), spinId));
      } catch (err) {
        throw toApiError(err);
      }
    },

    appeal: (teamId: string, spinId: string, reason: string) =>
      execute(teamId, (state) => decide.appealGuilt(state, spinId, reason, now())),

    decideAppeal: (teamId: string, spinId: string, outcome: 'uphold' | 'reject') =>
      execute(teamId, (state) =>
        decide.decideAppeal(state, spinId, outcome === 'uphold' ? 'upheld' : 'rejected', now()),
      ),

    async memberReport(teamId: string, memberId: string) {
      try {
        return memberReport(loadTeam(teamId), memberId);
      } catch (err) {
        throw toApiError(err);
      }
    },
  };
}

function now(): string {
  return new Date().toISOString();
}

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DomainError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400;
    return new ApiError(status, err.message, { error: err.message, ...err.details });
  }
  if (err instanceof Error) return new ApiError(500, err.message, { error: err.message });
  return new ApiError(500, String(err), { error: String(err) });
}
