import { type FormEvent, useState } from 'react';
import type { TeamView } from '../../server/views.ts';
import { api } from '../api.ts';
import { href } from '../route.ts';

type Props = { team: TeamView; setTeam: (t: TeamView) => void; reload: () => Promise<void> };

export function ParticipantsPage({ team, setTeam }: Props) {
  const [name, setName] = useState('');
  const [list, setList] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<TeamView>): Promise<boolean> {
    try {
      setTeam(await action());
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function addOne(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.addMembers(team.teamId, [name]))) setName('');
  }

  async function addList(e: FormEvent) {
    e.preventDefault();
    const names = list
      .split(/\r?\n|[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    if (await run(() => api.addMembers(team.teamId, names))) setList('');
  }

  async function grantImmunity(memberId: string) {
    const reason =
      window.prompt('Grund für die Immunität (z. B. Fahrgastrecht):', 'Fahrgastrecht') ?? '';
    await run(() => api.grantImmunity(team.teamId, memberId, reason));
  }

  const active = team.members.filter((m) => m.active);
  const inactive = team.members.filter((m) => !m.active);
  const immunities = (memberId: string) =>
    team.immunities.filter((i) => i.memberId === memberId).length;

  return (
    <>
      <h1>Teilnehmer</h1>
      {error && <p className="error-text">{error}</p>}
      <section className="split">
        <form onSubmit={addOne} className="stack">
          <h2>Einzeln zusteigen</h2>
          <label className="field">
            <span className="label">Name</span>
            <input
              data-testid="add-member-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </label>
          <button type="submit" data-testid="add-member-button" className="primary">
            Hinzufügen
          </button>
        </form>
        <form onSubmit={addList} className="stack">
          <h2>Liste einfügen</h2>
          <label className="field">
            <span className="label">Ein Name pro Zeile</span>
            <textarea
              data-testid="paste-list-textarea"
              rows={4}
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          </label>
          <button type="submit" data-testid="paste-list-button">
            Liste übernehmen
          </button>
        </form>
      </section>

      <section>
        <h2>Aktiv ({active.length})</h2>
        <table className="board">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.memberId} data-testid="member-row">
                <td>
                  <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                </td>
                <td>
                  <span className="chip ok">fahrbereit</span>
                  {immunities(m.memberId) > 0 && (
                    <span className="chip">immun ×{immunities(m.memberId)}</span>
                  )}
                </td>
                <td className="actions">
                  <button type="button" onClick={() => grantImmunity(m.memberId)}>
                    Immunität
                  </button>
                  <button
                    type="button"
                    data-testid="deactivate-button"
                    onClick={() => run(() => api.deactivateMember(team.teamId, m.memberId))}
                  >
                    Abmelden
                  </button>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Niemand an Bord.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {inactive.length > 0 && (
        <section>
          <h2>Abgemeldet ({inactive.length})</h2>
          <p className="muted">Bleiben in der Historie. Abwesenheit löscht keine Schuld.</p>
          <table className="board">
            <tbody>
              {inactive.map((m) => (
                <tr key={m.memberId} data-testid="member-row">
                  <td>
                    <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                  </td>
                  <td>
                    <span className="chip off">fällt aus</span>
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      data-testid="reactivate-button"
                      onClick={() => run(() => api.reactivateMember(team.teamId, m.memberId))}
                    >
                      Wieder anmelden
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Pools team={team} setTeam={setTeam} onError={setError} />
    </>
  );
}

function Pools({
  team,
  setTeam,
  onError,
}: {
  team: TeamView;
  setTeam: (t: TeamView) => void;
  onError: (e: string) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      setTeam(await api.createPool(team.teamId, name, selected));
      setName('');
      setSelected([]);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  async function togglePoolMember(poolId: string, memberIds: string[], id: string) {
    const next = memberIds.includes(id) ? memberIds.filter((x) => x !== id) : [...memberIds, id];
    try {
      setTeam(await api.changePoolMembers(team.teamId, poolId, next));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section>
      <h2>Gleise (Pools)</h2>
      <p className="muted">
        Optionale Teilmengen, z. B. „Backend“ oder „Daily“. Ohne Pool fahren alle Aktiven.
      </p>
      {team.pools.map((pool) => (
        <div key={pool.poolId} className="pool">
          <strong>{pool.name}</strong>
          <div className="checks">
            {team.members.map((m) => (
              <label key={m.memberId} className={m.active ? '' : 'muted'}>
                <input
                  type="checkbox"
                  checked={pool.memberIds.includes(m.memberId)}
                  onChange={() => togglePoolMember(pool.poolId, pool.memberIds, m.memberId)}
                />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      <form onSubmit={create} className="stack">
        <label className="field">
          <span className="label">Neues Gleis</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <div className="checks">
          {team.members.map((m) => (
            <label key={m.memberId}>
              <input
                type="checkbox"
                checked={selected.includes(m.memberId)}
                onChange={() => toggle(m.memberId)}
              />
              {m.name}
            </label>
          ))}
        </div>
        <button type="submit">Gleis anlegen</button>
      </form>
    </section>
  );
}
