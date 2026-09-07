import { serverApi } from './serverApi.ts';
import { createSessionApi } from './sessionApi.ts';

export { ApiError, errorMessage } from './apiError.ts';
export type { Api } from './serverApi.ts';

export const serverMode = import.meta.env.VITE_API_MODE === 'server';
export const api = serverMode ? serverApi : createSessionApi();

/** Recently opened teams, for the start page. Storage may be unavailable (private mode). */
export function rememberTeam(teamId: string, name: string) {
  try {
    const list = recentTeams().filter((team) => team.teamId !== teamId);
    sessionStorage.setItem(
      'schuldrad.recent',
      JSON.stringify([{ teamId, name }, ...list].slice(0, 8)),
    );
  } catch {
    // ignore
  }
}

export function recentTeams(): { teamId: string; name: string }[] {
  try {
    return JSON.parse(sessionStorage.getItem('schuldrad.recent') ?? '[]') as {
      teamId: string;
      name: string;
    }[];
  } catch {
    return [];
  }
}
