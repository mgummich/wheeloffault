import { type FormEvent, useEffect, useState } from 'react';
import type { TeamListEntry } from '../../server/views.ts';
import { api, errorMessage, recentTeams } from '../api.ts';
import { href, navigate } from '../route.ts';

export function HomePage() {
  const [teams, setTeams] = useState<TeamListEntry[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listTeams()
      .then(setTeams)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const team = await api.createTeam(name);
      navigate(href.team(team.teamId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const recent = recentTeams();
  return (
    <>
      <section className="hero">
        <p className="label">Betriebszentrale</p>
        <h1>Wer ist diesmal schuldig?</h1>
        <p className="lede">
          Nachvollziehbare Ziehungen nach Commit/Reveal-Verfahren, lückenlose Historie,
          Schuldberichte nach Fahrgastrechte-Standard.
        </p>
      </section>

      <section className="split">
        <form onSubmit={create} className="stack">
          <h2>Neues Team anlegen</h2>
          <label className="field">
            <span className="label">Teamname</span>
            <input
              data-testid="create-team-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <button
            type="submit"
            data-testid="create-team-button"
            className="primary"
            disabled={busy}
          >
            Team eröffnen
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>

        <div className="stack">
          <h2>Abfahrten</h2>
          {teams.length === 0 && <p className="muted">Noch keine Teams. Der Bahnsteig ist leer.</p>}
          <table className="board">
            <tbody>
              {teams.map((t) => (
                <tr key={t.teamId}>
                  <td>
                    <a href={href.team(t.teamId)}>{t.name}</a>
                  </td>
                  <td className="num">{t.memberCount} aktiv</td>
                  <td className="num">{t.spinCount} Ziehungen</td>
                  {recent.some((r) => r.teamId === t.teamId) && (
                    <td>
                      <span className="chip">zuletzt</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
