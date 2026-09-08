import { type FormEvent, useState } from 'react';
import { type Verification, verifySpin } from '../../domain/fairness/draw.ts';
import type { TeamView } from '../../domain/views.ts';
import { api, errorMessage } from '../api.ts';
import { dateTime, factor, percent, probabilityOf, spinLabel } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { href } from '../route.ts';

type Props = {
  team: TeamView;
  setTeam: (t: TeamView) => void;
  spinId: string;
};

export function SpinDetailPage({ team, setTeam, spinId }: Props) {
  const { t } = useI18n();
  const spin = team.spins.find((s) => s.spinId === spinId);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!spin) return <p className="error-text">{t('spinDetail.unknown', { id: spinId })}</p>;
  const nameOf = (id: string) => team.members.find((m) => m.memberId === id)?.name ?? id;
  const reveal = spin.reveal;
  const proof = reveal
    ? { nonce: spin.nonce, commitment: spin.commitment, participants: spin.participants, ...reveal }
    : null;

  async function run(action: () => Promise<TeamView>) {
    try {
      setTeam(await action());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function verify() {
    if (!proof) return;
    setVerification(await verifySpin(proof));
  }

  async function appeal(e: FormEvent) {
    e.preventDefault();
    await run(() => api.appeal(team.teamId, spinId, reason));
  }

  return (
    <>
      <p className="label">{t('nav.spin')}</p>
      <h1>{t('spinDetail.title', { label: spinLabel(spin.nonce) })}</h1>
      <p className="muted">
        {t('spinDetail.committedAt', { date: dateTime(spin.committedAt) })}
        {reveal && <> · {t('spinDetail.revealedAt', { date: dateTime(reveal.revealedAt) })}</>}
        {reveal && (
          <>
            {' '}
            · {t('spinDetail.guiltyPrefix')}{' '}
            <a href={href.bericht(team.teamId, reveal.selectedMemberId)}>
              {nameOf(reveal.selectedMemberId)}
            </a>
          </>
        )}
        {spin.appeal?.outcome === 'upheld' && (
          <span className="chip"> {t('common.chipOverturned')}</span>
        )}
      </p>
      {error && (
        <p className="error-text" id="spin-detail-error" role="alert">
          {error}
        </p>
      )}

      <section>
        <h2>{t('spinDetail.participantsHeading')}</h2>
        <table className="board">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th className="num">{t('common.weight')}</th>
              <th className="num">{t('common.probability')}</th>
              {spin.modifiers.map((m) => (
                <th key={m.name} className="num">
                  {m.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spin.participants.map((p) => (
              <tr
                key={p.memberId}
                className={reveal?.selectedMemberId === p.memberId ? 'selected' : ''}
              >
                <td>{nameOf(p.memberId)}</td>
                <td className="num">{p.weight}</td>
                <td className="num">{percent(probabilityOf(spin.participants, p.memberId))}</td>
                {spin.modifiers.map((m) => (
                  <td key={m.name} className="num">
                    {factor(m.factors[p.memberId] ?? 1000)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>{t('spinDetail.proofHeading')}</h2>
        <table className="board kv mono">
          <tbody>
            <tr>
              <th scope="row">{t('spinDetail.nonce')}</th>
              <td>{spin.nonce}</td>
            </tr>
            <tr>
              <th scope="row">{t('spinDetail.commitment')}</th>
              <td>{spin.commitment}</td>
            </tr>
            {reveal ? (
              <>
                <tr>
                  <th scope="row">{t('spinDetail.serverSeed')}</th>
                  <td>{reveal.serverSeed}</td>
                </tr>
                <tr>
                  <th scope="row">{t('spinDetail.clientSeed')}</th>
                  <td>{reveal.clientSeed}</td>
                </tr>
                <tr>
                  <th scope="row">HMAC-SHA-256</th>
                  <td>{reveal.digest}</td>
                </tr>
              </>
            ) : (
              <tr>
                <th scope="row">{t('spinDetail.serverSeed')}</th>
                <td className="muted">{t('spinDetail.serverSeedHidden')}</td>
              </tr>
            )}
          </tbody>
        </table>
        {proof && (
          <div className="stack">
            <div className="actions">
              <button type="button" data-testid="verify-button" onClick={verify}>
                {t('spinDetail.verifyButton')}
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(proof, null, 2))}
              >
                {t('spinDetail.copyProofButton')}
              </button>
            </div>
            {verification && (
              <ul className="checks-list" data-testid="verify-result">
                <Check
                  ok={verification.commitmentMatches}
                  label={t('spinDetail.checkCommitment')}
                />
                <Check ok={verification.digestMatches} label={t('spinDetail.checkDigest')} />
                <Check ok={verification.selectionMatches} label={t('spinDetail.checkSelection')} />
                <li>
                  <strong>
                    {verification.ok ? t('spinDetail.valid') : t('spinDetail.invalid')}
                  </strong>
                </li>
              </ul>
            )}
          </div>
        )}
      </section>

      {reveal && (
        <section>
          <h2>{t('spinDetail.appealHeading')}</h2>
          {spin.appeal ? (
            <div className="stack">
              <p>
                <span className="chip">
                  {spin.appeal.outcome === 'open'
                    ? t('common.chipOpen')
                    : spin.appeal.outcome === 'upheld'
                      ? t('common.chipUpheld')
                      : t('common.chipRejected')}
                </span>{' '}
                {spin.appeal.reason}
              </p>
              {spin.appeal.outcome === 'open' && (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => run(() => api.decideAppeal(team.teamId, spin.spinId, 'uphold'))}
                  >
                    {t('spinDetail.upholdButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => api.decideAppeal(team.teamId, spin.spinId, 'reject'))}
                  >
                    {t('spinDetail.rejectButton')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={appeal} className="stack">
              <label className="field">
                <span className="label">{t('spinDetail.reasonLabel')}</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  required
                  aria-describedby={error ? 'spin-detail-error' : undefined}
                />
              </label>
              <button type="submit">{t('spinDetail.fileAppealButton')}</button>
            </form>
          )}
        </section>
      )}
    </>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <li>
      <span className={`chip ${ok ? 'ok' : 'red'}`}>
        {ok ? t('common.ok') : t('common.errorShort')}
      </span>{' '}
      {label}
    </li>
  );
}
