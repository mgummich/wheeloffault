import { useSyncExternalStore } from 'react';

/** `#/team/:id/:page/:arg` — the hash is the whole router. */
export type Route =
  | { page: 'home' }
  | { page: 'spin'; teamId: string }
  | { page: 'teilnehmer'; teamId: string }
  | { page: 'statistik'; teamId: string }
  | { page: 'fairness'; teamId: string }
  | { page: 'bericht'; teamId: string; memberId: string }
  | { page: 'ziehung'; teamId: string; spinId: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] !== 'team' || !parts[1]) return { page: 'home' };
  const teamId = decodeURIComponent(parts[1]);
  const arg = parts[3] ? decodeURIComponent(parts[3]) : '';
  switch (parts[2]) {
    case 'teilnehmer':
    case 'statistik':
    case 'fairness':
      return { page: parts[2], teamId };
    case 'bericht':
      return arg ? { page: 'bericht', teamId, memberId: arg } : { page: 'spin', teamId };
    case 'ziehung':
      return arg ? { page: 'ziehung', teamId, spinId: arg } : { page: 'spin', teamId };
    default:
      return { page: 'spin', teamId };
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
}

export const href = {
  home: () => '#/',
  team: (id: string) => `#/team/${id}`,
  teilnehmer: (id: string) => `#/team/${id}/teilnehmer`,
  statistik: (id: string) => `#/team/${id}/statistik`,
  fairness: (id: string) => `#/team/${id}/fairness`,
  bericht: (id: string, memberId: string) => `#/team/${id}/bericht/${memberId}`,
  ziehung: (id: string, spinId: string) => `#/team/${id}/ziehung/${spinId}`,
};

export function navigate(to: string) {
  window.location.hash = to;
}
