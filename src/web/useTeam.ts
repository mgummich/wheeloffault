import { useCallback, useEffect, useState } from 'react';
import type { TeamView } from '../server/views.ts';
import { api, rememberTeam } from './api.ts';

/**
 * The client owns no domain state: this hook holds the last TeamView from
 * the server and refetches whenever the server reports a new event.
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [teamId]);

  useEffect(() => {
    void reload();
    const source = new EventSource(`/api/teams/${encodeURIComponent(teamId)}/events`);
    source.addEventListener('appended', () => void reload());
    return () => source.close();
  }, [teamId, reload]);

  return { team, error, setTeam, reload };
}
