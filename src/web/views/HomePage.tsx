import { type FormEvent, useEffect, useState } from 'react';
import type { TeamListEntry } from '../../domain/views.ts';
import { api, errorMessage, recentTeams } from '../api.ts';
import { useI18n } from '../i18n/index.ts';
import { href, navigate } from '../route.ts';

export function HomePage() {
  const { t } = useI18n();
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
        <p className="label">{t('home.label')}</p>
        <h1>{t('home.title')}</h1>
        <p className="lede">{t('home.lede')}</p>
      </section>

      <section className="split">
        <form onSubmit={create} className="stack">
          <h2>{t('home.createHeading')}</h2>
          <label className="field">
            <span className="label">{t('home.teamNameLabel')}</span>
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
            {t('home.createButton')}
          </button>
          {error && <p className="error-text">{error}</p>}
        </form>

        <div className="stack">
          <h2>{t('home.departuresHeading')}</h2>
          {teams.length === 0 && <p className="muted">{t('home.noTeams')}</p>}
          <table className="board">
            <tbody>
              {teams.map((team) => (
                <tr key={team.teamId}>
                  <td>
                    <a href={href.team(team.teamId)}>{team.name}</a>
                  </td>
                  <td className="num">{t('home.memberCount', { n: team.memberCount })}</td>
                  <td className="num">{t('home.spinCount', { n: team.spinCount })}</td>
                  {recent.some((r) => r.teamId === team.teamId) && (
                    <td>
                      <span className="chip">{t('home.recentChip')}</span>
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
