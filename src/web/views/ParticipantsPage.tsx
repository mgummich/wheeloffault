import { type FormEvent, useState } from 'react';
import type { TeamView } from '../../server/views.ts';
import { api, errorMessage } from '../api.ts';
import { href } from '../route.ts';

type Props = { team: TeamView; setTeam: (t: TeamView) => void; reload: () => Promise<void> };

export function ParticipantsPage({ team, setTeam }: Props) {
  const [name, setName] = useState('');
  const [list, setList] = useState('');
  const [error, setError] = useState<string | null>(null);
  // One in-flight mutation at a time: prevents double-adds and lost pool toggles.
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<TeamView>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      setTeam(await action());
      setError(null);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
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
    const reason = window.prompt('Grund für die Immunität (z. B. Fahrgastrecht):', 'Fahrgastrecht');
    if (reason === null) return; // Abbrechen darf keine Immunität vergeben.
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
          <button type="submit" data-testid="add-member-button" className="primary" disabled={busy}>
            Hinzufügen
          </button>
        </form>
        <form onSubmit={addList} className="stack">
          <h2>Liste einfügen</h2>
          <label className="field">
            <span className="label">Ein Name pro Zeile (Komma und Semikolon trennen auch)</span>
            <textarea
              data-testid="paste-list-textarea"
              rows={4}
              value={list}
              onChange={(e) => setList(e.target.value)}
            />
          </label>
          <button type="submit" data-testid="paste-list-button" disabled={busy}>
            Liste übernehmen
          </button>
        </form>
      </section>

      <section>
        <h2>Aktiv ({active.length})</h2>
        <table className="board participant-board">
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
                <td data-label="Name">
                  <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                </td>
                <td data-label="Status">
                  <span className="chip ok">fahrbereit</span>
                  {immunities(m.memberId) > 0 && (
                    <>
                      <span className="chip">immun ×{immunities(m.memberId)}</span>
                      <button
                        type="button"
                        className="quiet chip-action"
                        disabled={busy}
                        onClick={() => run(() => api.revokeImmunity(team.teamId, m.memberId))}
                      >
                        aufheben
                      </button>
                    </>
                  )}
                </td>
                <td className="actions">
                  <button type="button" disabled={busy} onClick={() => grantImmunity(m.memberId)}>
                    Immunität
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    data-testid="deactivate-button"
                    disabled={busy}
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
          <table className="board participant-board">
            <tbody>
              {inactive.map((m) => (
                <tr key={m.memberId} data-testid="member-row">
                  <td data-label="Name">
                    <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                  </td>
                  <td data-label="Status">
                    <span className="chip off">abgemeldet</span>
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      data-testid="reactivate-button"
                      disabled={busy}
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

      <Pools team={team} run={run} busy={busy} />
    </>
  );
}

function Pools({
  team,
  run,
  busy,
}: {
  team: TeamView;
  run: (action: () => Promise<TeamView>) => Promise<boolean>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<{ poolId: string; name: string } | null>(null);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function create(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.createPool(team.teamId, name, selected))) {
      setName('');
      setSelected([]);
    }
  }

  async function togglePoolMember(poolId: string, id: string) {
    // Always compute from the freshest team state; `run` serializes requests.
    const memberIds = team.pools.find((p) => p.poolId === poolId)?.memberIds ?? [];
    const next = memberIds.includes(id) ? memberIds.filter((x) => x !== id) : [...memberIds, id];
    await run(() => api.changePoolMembers(team.teamId, poolId, next));
  }

  async function remove(poolId: string, poolName: string) {
    if (!window.confirm(`Gleis „${poolName}“ entfernen? Ziehungen bleiben erhalten.`)) return;
    await run(() => api.deletePool(team.teamId, poolId));
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    if (await run(() => api.renamePool(team.teamId, renaming.poolId, renaming.name))) {
      setRenaming(null);
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
          {renaming?.poolId === pool.poolId ? (
            <form onSubmit={rename} className="actions">
              <input
                value={renaming.name}
                onChange={(e) => setRenaming({ poolId: pool.poolId, name: e.target.value })}
                maxLength={60}
                required
                // biome-ignore lint/a11y/noAutofocus: the form appears on explicit request; focus belongs in it.
                autoFocus
              />
              <button type="submit" disabled={busy}>
                Speichern
              </button>
              <button type="button" className="quiet" onClick={() => setRenaming(null)}>
                Abbrechen
              </button>
            </form>
          ) : (
            <div className="actions">
              <strong>{pool.name}</strong>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => setRenaming({ poolId: pool.poolId, name: pool.name })}
              >
                Umbenennen
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => remove(pool.poolId, pool.name)}
              >
                Entfernen
              </button>
            </div>
          )}
          <div className="checks">
            {team.members.map((m) => (
              <label key={m.memberId} className={m.active ? '' : 'muted'}>
                <input
                  type="checkbox"
                  checked={pool.memberIds.includes(m.memberId)}
                  disabled={busy}
                  onChange={() => togglePoolMember(pool.poolId, m.memberId)}
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
        <button type="submit" disabled={busy}>
          Gleis anlegen
        </button>
      </form>
    </section>
  );
}
