import type { FairnessPolicy } from '../domain/fairness/policy.ts';
import type { MemberReport } from '../domain/projections/report.ts';
import type { SpinView, TeamListEntry, TeamView } from '../server/views.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === 'string' ? data.error : res.statusText,
      data,
    );
  }
  return data as T;
}

const team = (id: string) => `/teams/${encodeURIComponent(id)}`;

export const api = {
  listTeams: () => request<TeamListEntry[]>('GET', '/teams'),
  createTeam: (name: string) => request<TeamView>('POST', '/teams', { name }),
  getTeam: (id: string) => request<TeamView>('GET', team(id)),
  addMembers: (id: string, names: string[]) =>
    request<TeamView>('POST', `${team(id)}/members`, { names }),
  deactivateMember: (id: string, memberId: string) =>
    request<TeamView>('POST', `${team(id)}/members/${memberId}/deactivate`),
  reactivateMember: (id: string, memberId: string) =>
    request<TeamView>('POST', `${team(id)}/members/${memberId}/reactivate`),
  grantImmunity: (id: string, memberId: string, reason: string) =>
    request<TeamView>('POST', `${team(id)}/members/${memberId}/immunity`, { reason }),
  memberReport: (id: string, memberId: string) =>
    request<MemberReport>('GET', `${team(id)}/members/${memberId}/report`),
  changePolicy: (id: string, policy: FairnessPolicy) =>
    request<TeamView>('PUT', `${team(id)}/policy`, policy),
  createPool: (id: string, name: string, memberIds: string[]) =>
    request<TeamView>('POST', `${team(id)}/pools`, { name, memberIds }),
  changePoolMembers: (id: string, poolId: string, memberIds: string[]) =>
    request<TeamView>('PUT', `${team(id)}/pools/${poolId}`, { memberIds }),
  commitSpin: (id: string, spinId: string, poolId: string | null) =>
    request<SpinView>('POST', `${team(id)}/spins`, { spinId, poolId }),
  revealSpin: (id: string, spinId: string, clientSeed: string) =>
    request<SpinView>('POST', `${team(id)}/spins/${spinId}/reveal`, { clientSeed }),
  appeal: (id: string, spinId: string, reason: string) =>
    request<TeamView>('POST', `${team(id)}/spins/${spinId}/appeal`, { reason }),
  decideAppeal: (id: string, spinId: string, outcome: 'uphold' | 'reject') =>
    request<TeamView>('POST', `${team(id)}/spins/${spinId}/appeal/${outcome}`),
};

/** Recently opened teams, for the start page. Storage may be unavailable (private mode). */
export function rememberTeam(teamId: string, name: string) {
  try {
    const list = recentTeams().filter((t) => t.teamId !== teamId);
    localStorage.setItem(
      'schuldrad.recent',
      JSON.stringify([{ teamId, name }, ...list].slice(0, 8)),
    );
  } catch {
    // ignore
  }
}

export function recentTeams(): { teamId: string; name: string }[] {
  try {
    return JSON.parse(localStorage.getItem('schuldrad.recent') ?? '[]') as {
      teamId: string;
      name: string;
    }[];
  } catch {
    return [];
  }
}
