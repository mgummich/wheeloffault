import { type FormEvent, useState } from 'react';
import { type Verification, verifySpin } from '../../domain/fairness/draw.ts';
import type { TeamView } from '../../server/views.ts';
import { api, errorMessage } from '../api.ts';
import { dateTime, factor, percent, probabilityOf, spinLabel } from '../format.ts';
import { href } from '../route.ts';

type Props = {
  team: TeamView;
  setTeam: (t: TeamView) => void;
  spinId: string;
};

export function SpinDetailPage({ team, setTeam, spinId }: Props) {
  const spin = team.spins.find((s) => s.spinId === spinId);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!spin) return <p className="error-text">Ziehung {spinId} unbekannt.</p>;
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
      <p className="label">Ziehung</p>
      <h1>Zug {spinLabel(spin.nonce)}</h1>
      <p className="muted">
        Festgelegt {dateTime(spin.committedAt)}
        {reveal && <> · Aufgedeckt {dateTime(reveal.revealedAt)}</>}
        {reveal && (
          <>
            {' '}
            · Schuldig:{' '}
            <a href={href.bericht(team.teamId, reveal.selectedMemberId)}>
              {nameOf(reveal.selectedMemberId)}
            </a>
          </>
        )}
        {spin.appeal?.outcome === 'upheld' && <span className="chip"> aufgehoben</span>}
      </p>
      {error && <p className="error-text">{error}</p>}

      <section>
        <h2>Teilnehmer und Gewichte</h2>
        <table className="board">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Gewicht</th>
              <th className="num">Wahrscheinl.</th>
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
        <h2>Nachweis</h2>
        <table className="board kv mono">
          <tbody>
            <tr>
              <th scope="row">Nonce</th>
              <td>{spin.nonce}</td>
            </tr>
            <tr>
              <th scope="row">Commitment</th>
              <td>{spin.commitment}</td>
            </tr>
            {reveal ? (
              <>
                <tr>
                  <th scope="row">Server-Seed</th>
                  <td>{reveal.serverSeed}</td>
                </tr>
                <tr>
                  <th scope="row">Client-Seed</th>
                  <td>{reveal.clientSeed}</td>
                </tr>
                <tr>
                  <th scope="row">HMAC-SHA-256</th>
                  <td>{reveal.digest}</td>
                </tr>
              </>
            ) : (
              <tr>
                <th scope="row">Server-Seed</th>
                <td className="muted">wird erst nach dem Aufdecken veröffentlicht</td>
              </tr>
            )}
          </tbody>
        </table>
        {proof && (
          <div className="stack">
            <div className="actions">
              <button type="button" data-testid="verify-button" onClick={verify}>
                Im Browser prüfen
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(proof, null, 2))}
              >
                Nachweis kopieren
              </button>
            </div>
            {verification && (
              <ul className="checks-list" data-testid="verify-result">
                <Check
                  ok={verification.commitmentMatches}
                  label="Commitment = SHA-256(Server-Seed, Nonce, Gewichte)"
                />
                <Check
                  ok={verification.digestMatches}
                  label="HMAC-SHA-256(Server-Seed, Commitment:Client-Seed:Nonce)"
                />
                <Check ok={verification.selectionMatches} label="Ergebnis folgt aus dem HMAC" />
                <li>
                  <strong>
                    {verification.ok ? 'Ziehung gültig' : 'Ziehung NICHT reproduzierbar'}
                  </strong>
                </li>
              </ul>
            )}
          </div>
        )}
      </section>

      {reveal && (
        <section>
          <h2>Einspruch</h2>
          {spin.appeal ? (
            <div className="stack">
              <p>
                <span className="chip">
                  {spin.appeal.outcome === 'open'
                    ? 'offen'
                    : spin.appeal.outcome === 'upheld'
                      ? 'stattgegeben'
                      : 'abgelehnt'}
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
                    Stattgeben
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => api.decideAppeal(team.teamId, spin.spinId, 'reject'))}
                  >
                    Ablehnen
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={appeal} className="stack">
              <label className="field">
                <span className="label">Begründung</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  required
                />
              </label>
              <button type="submit">Einspruch einlegen</button>
            </form>
          )}
        </section>
      )}
    </>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li>
      <span className={`chip ${ok ? 'ok' : 'red'}`}>{ok ? 'OK' : 'FEHLER'}</span> {label}
    </li>
  );
}
