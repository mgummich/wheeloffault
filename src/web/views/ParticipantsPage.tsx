import { type FormEvent, useEffect, useRef, useState } from 'react';
import { MAX_NAME } from '../../domain/decisions.ts';
import type { TeamView } from '../../domain/views.ts';
import { api, errorMessage } from '../api.ts';
import { useI18n } from '../i18n/index.ts';
import { href } from '../route.ts';

type Props = { team: TeamView; setTeam: (t: TeamView) => void };

export function ParticipantsPage({ team, setTeam }: Props) {
  const { t } = useI18n();
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
    // Mirror the server's length limit here so one bad line names itself
    // instead of the whole batch failing on a generic "name too long".
    const tooLong = names.filter((n) => n.length > MAX_NAME);
    if (tooLong.length > 0) {
      setError(t('participants.lineRejected', { name: tooLong.join(', '), max: MAX_NAME }));
      return;
    }
    if (await run(() => api.addMembers(team.teamId, names))) setList('');
  }

  const [immunityFor, setImmunityFor] = useState<string | null>(null);

  const active = team.members.filter((m) => m.active);
  const inactive = team.members.filter((m) => !m.active);
  const immunities = (memberId: string) =>
    team.immunities.filter((i) => i.memberId === memberId).length;

  return (
    <>
      <h1>{t('participants.title')}</h1>
      {error && (
        <p className="error-text" id="participants-error" role="alert">
          {error}
        </p>
      )}
      <section className="split">
        <form onSubmit={addOne} className="stack">
          <h2>{t('participants.addOneHeading')}</h2>
          <label className="field">
            <span className="label">{t('common.name')}</span>
            <input
              data-testid="add-member-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              required
              aria-describedby={error ? 'participants-error' : undefined}
            />
          </label>
          <button type="submit" data-testid="add-member-button" className="primary" disabled={busy}>
            {t('participants.addButton')}
          </button>
        </form>
        <form onSubmit={addList} className="stack">
          <h2>{t('participants.pasteHeading')}</h2>
          <label className="field">
            <span className="label">{t('participants.pasteLabel')}</span>
            <textarea
              data-testid="paste-list-textarea"
              rows={4}
              value={list}
              onChange={(e) => setList(e.target.value)}
              aria-describedby={error ? 'participants-error' : undefined}
            />
          </label>
          <button type="submit" data-testid="paste-list-button" disabled={busy}>
            {t('participants.pasteButton')}
          </button>
        </form>
      </section>

      <section>
        <h2>{t('participants.activeHeading', { n: active.length })}</h2>
        <table className="board participant-board">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.memberId} data-testid="member-row">
                <td data-label={t('common.name')}>
                  <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                </td>
                <td data-label={t('common.status')}>
                  <span className="chip ok">{t('participants.readyChip')}</span>
                  {immunities(m.memberId) > 0 && (
                    <>
                      <span className="chip">
                        {t('participants.immuneChip', { n: immunities(m.memberId) })}
                      </span>
                      <button
                        type="button"
                        className="quiet chip-action"
                        disabled={busy}
                        onClick={() => run(() => api.revokeImmunity(team.teamId, m.memberId))}
                      >
                        {t('participants.revokeButton')}
                      </button>
                    </>
                  )}
                </td>
                <td className="actions">
                  <button type="button" disabled={busy} onClick={() => setImmunityFor(m.memberId)}>
                    {t('participants.immunityButton')}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    data-testid="deactivate-button"
                    disabled={busy}
                    onClick={() => run(() => api.deactivateMember(team.teamId, m.memberId))}
                  >
                    {t('participants.deactivateButton')}
                  </button>
                </td>
              </tr>
            ))}
            {active.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  {t('participants.noneActive')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {inactive.length > 0 && (
        <section>
          <h2>{t('participants.inactiveHeading', { n: inactive.length })}</h2>
          <p className="muted">{t('participants.inactiveNote')}</p>
          <table className="board participant-board">
            <tbody>
              {inactive.map((m) => (
                <tr key={m.memberId} data-testid="member-row">
                  <td data-label={t('common.name')}>
                    <a href={href.bericht(team.teamId, m.memberId)}>{m.name}</a>
                  </td>
                  <td data-label={t('common.status')}>
                    <span className="chip off">{t('participants.inactiveChip')}</span>
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      data-testid="reactivate-button"
                      disabled={busy}
                      onClick={() => run(() => api.reactivateMember(team.teamId, m.memberId))}
                    >
                      {t('participants.reactivateButton')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Pools team={team} run={run} busy={busy} />

      {immunityFor && (
        <ImmunityDialog
          onCancel={() => setImmunityFor(null)}
          onSubmit={async (reason) => {
            if (await run(() => api.grantImmunity(team.teamId, immunityFor, reason))) {
              setImmunityFor(null);
            }
          }}
        />
      )}
    </>
  );
}

/** Native <dialog> via showModal(): focus trap, Esc handling, backdrop and
 * focus restore on close come for free (see ShareDialog). */
function ImmunityDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState(t('participants.immunityDefaultReason'));
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse convenience; the keyboard path is the native Esc handling of <dialog>.
    <dialog
      ref={dialogRef}
      className="small-dialog"
      aria-labelledby="sr-immunity-h"
      onClose={onCancel}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason);
        }}
      >
        <h2 id="sr-immunity-h">{t('participants.immunityButton')}</h2>
        <label className="field">
          <span className="label">{t('participants.immunityPrompt')}</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            autoFocus
          />
        </label>
        <div className="actions">
          <button type="submit" className="primary">
            {t('participants.immunityButton')}
          </button>
          <button type="button" className="quiet" onClick={() => dialogRef.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
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
  const { t } = useI18n();
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
    if (!window.confirm(t('participants.removePoolConfirm', { name: poolName }))) return;
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
      <h2>{t('participants.poolsHeading')}</h2>
      <p className="muted">{t('participants.poolsNote')}</p>
      {team.pools.map((pool) => (
        <div key={pool.poolId} className="pool">
          {renaming?.poolId === pool.poolId ? (
            <form onSubmit={rename} className="actions">
              <input
                value={renaming.name}
                onChange={(e) => setRenaming({ poolId: pool.poolId, name: e.target.value })}
                maxLength={MAX_NAME}
                required
                // biome-ignore lint/a11y/noAutofocus: the form appears on explicit request; focus belongs in it.
                autoFocus
              />
              <button type="submit" disabled={busy}>
                {t('common.save')}
              </button>
              <button type="button" className="quiet" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
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
                {t('participants.renameButton')}
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => remove(pool.poolId, pool.name)}
              >
                {t('participants.removeButton')}
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
          <span className="label">{t('participants.newPoolLabel')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME}
            required
          />
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
          {t('participants.createPoolButton')}
        </button>
      </form>
    </section>
  );
}
