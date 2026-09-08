import type { FairnessPolicy } from '../domain/fairness/policy.ts';
import type { MemberReport } from '../domain/projections/report.ts';
import type { SpinView, TeamListEntry, TeamView } from '../domain/views.ts';

import { ApiError } from './apiError.ts';
import { markUnauthenticated } from './authState.ts';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && data.code === 'unauthorized') markUnauthenticated();
    throw new ApiError(
      res.status,
      typeof data.error === 'string' ? data.error : res.statusText,
      data,
    );
  }
  return data as T;
}

const team = (id: string) => `/teams/${encodeURIComponent(id)}`;

export const serverApi = {
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
  renamePool: (id: string, poolId: string, name: string) =>
    request<TeamView>('POST', `${team(id)}/pools/${poolId}/rename`, { name }),
  deletePool: (id: string, poolId: string) =>
    request<TeamView>('DELETE', `${team(id)}/pools/${poolId}`),
  revokeImmunity: (id: string, memberId: string) =>
    request<TeamView>('DELETE', `${team(id)}/members/${memberId}/immunity`),
  commitSpin: (id: string, spinId: string, poolId: string | null) =>
    request<SpinView>('POST', `${team(id)}/spins`, { spinId, poolId }),
  revealSpin: (id: string, spinId: string, clientSeed: string) =>
    request<SpinView>('POST', `${team(id)}/spins/${spinId}/reveal`, { clientSeed }),
  appeal: (id: string, spinId: string, reason: string) =>
    request<TeamView>('POST', `${team(id)}/spins/${spinId}/appeal`, { reason }),
  decideAppeal: (id: string, spinId: string, outcome: 'uphold' | 'reject') =>
    request<TeamView>('POST', `${team(id)}/spins/${spinId}/appeal/${outcome}`),
};

/** The shared contract both backends implement (see createSessionApi). */
export type Api = typeof serverApi;
