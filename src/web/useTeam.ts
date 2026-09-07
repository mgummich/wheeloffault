import { useCallback, useEffect, useState } from 'react';
import type { TeamView } from '../server/views.ts';
import { api, errorMessage, rememberTeam, serverMode } from './api.ts';

/**
 * Rehydrate local sessions on reload; server builds also refresh on SSE
 * events and reconnections so other browsers see persisted changes.
 *
 * Mutating pages call setTeam with the response directly; the SSE `appended`
 * reload that follows is the echo of our own append (harmless double fetch).
 */
export function useTeam(teamId: string) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const view = await api.getTeam(teamId);
      setTeam(view);
      setError(null);
      rememberTeam(view.teamId, view.name);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [teamId]);

  useEffect(() => {
    void reload();
    if (!serverMode) return;
    const source = new EventSource(`/api/teams/${encodeURIComponent(teamId)}/events`);
    source.addEventListener('appended', () => void reload());
    source.addEventListener('open', () => void reload());
    return () => source.close();
  }, [teamId, reload]);

  return { team, error, setTeam, reload };
}
