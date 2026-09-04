import { useCallback, useEffect, useMemo, useState } from 'react';
import { randomHex } from '../../domain/fairness/draw.ts';
import type { SpinView, TeamView } from '../../server/views.ts';
import { ApiError, api } from '../api.ts';
import { href } from '../route.ts';
import { Wheel } from '../wheel/Wheel.tsx';

type Props = { team: TeamView; setTeam: (t: TeamView) => void; reload: () => Promise<void> };

type Phase =
  | { kind: 'idle' }
  | { kind: 'drawing' }
  | { kind: 'animating'; spin: SpinView }
  | { kind: 'announced'; spin: SpinView };

/** A refresh mid-reveal must retry with the same client seed, otherwise the server (rightly) refuses. */
function clientSeedFor(spinId: string): string {
  const key = `schuldrad.clientSeed.${spinId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const seed = randomHex(16);
    sessionStorage.setItem(key, seed);
    return seed;
  } catch {
    return randomHex(16);
  }
}

export function SpinPage({ team, reload }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [poolId, setPoolId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => team.members.find((m) => m.memberId === id)?.name ?? id;

  /** Commit → reveal → only then animate to the persisted result. */
  const draw = useCallback(
    async (resumeSpinId?: string) => {
      if (phase.kind === 'drawing') return;
      setPhase({ kind: 'drawing' });
      setError(null);
      try {
        let spinId = resumeSpinId ?? crypto.randomUUID();
        if (!resumeSpinId) {
          try {
            await api.commitSpin(team.teamId, spinId, poolId || null);
          } catch (err) {
            // Someone (or a retry) already opened a spin: finish that one instead.
            if (
              err instanceof ApiError &&
              err.status === 409 &&
              typeof err.body.spinId === 'string'
            ) {
              spinId = err.body.spinId;
            } else throw err;
          }
        }
        let revealed: SpinView;
        try {
          revealed = await api.revealSpin(team.teamId, spinId, clientSeedFor(spinId));
        } catch (err) {
          // Another browser revealed first with its own client seed: the persisted result wins.
          if (!(err instanceof ApiError && err.status === 409)) throw err;
          const fresh = await api.getTeam(team.teamId);
          const done = fresh.spins.find((s) => s.spinId === spinId && s.reveal);
          if (!done) throw err;
          revealed = done;
        }
        setPhase({ kind: 'animating', spin: revealed });
        void reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase({ kind: 'idle' });
      }
    },
    [phase.kind, team.teamId, poolId, reload],
  );

  const finish = useCallback(() => {
    setPhase((p) => (p.kind === 'animating' ? { kind: 'announced', spin: p.spin } : p));
  }, []);

  // Participants of the current draw, or a preview of who would be on the wheel.
  const wheelParticipants =
    phase.kind === 'animating' || phase.kind === 'announced'
      ? phase.spin.participants.map((p) => ({ ...p, name: nameOf(p.memberId) }))
      : previewParticipants(team, poolId);

  const spin = phase.kind === 'animating' || phase.kind === 'announced' ? phase.spin : null;
  const selectedName = spin?.reveal ? nameOf(spin.reveal.selectedMemberId) : '';
  // Stable per spin: the wheel's effect keys on it and must not restart on every team reload.
  const result = useMemo(
    () => (spin?.reveal ? { ...spin, selectedName } : null),
    [spin, selectedName],
  );

  useEffect(() => {
    if (!result || phase.kind !== 'announced') return;
    document.title = `Schuldig: ${result.selectedName} · Schuldrad`;
    return () => {
      document.title = 'Schuldrad';
    };
  }, [result, phase.kind]);

  const activeCount = team.members.filter((m) => m.active).length;

  return (
    <>
      <div className="spin-head">
        <div>
          <p className="label">Team</p>
          <h1>{team.name}</h1>
        </div>
        <label className="field compact">
          <span className="label">Gleis</span>
          <select
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            disabled={phase.kind !== 'idle'}
          >
            <option value="">Alle Aktiven ({activeCount})</option>
            {team.pools.map((p) => (
              <option key={p.poolId} value={p.poolId}>
                {p.name} ({p.memberIds.length})
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeCount === 0 && (
        <p className="notice">
          Keine aktiven Teilnehmer. <a href={href.teilnehmer(team.teamId)}>Teilnehmer verwalten</a>
        </p>
      )}

      <Wheel
        participants={wheelParticipants}
        result={phase.kind === 'animating' || phase.kind === 'announced' ? result : null}
        onFinished={finish}
      />

      {error && <p className="error-text">{error}</p>}

      {phase.kind === 'idle' && team.pendingSpin && (
        <div className="notice">
          <p>
            Ziehung SR {String(team.pendingSpin.nonce).padStart(4, '0')} läuft (festgelegt, noch
            nicht aufgedeckt).
          </p>
          <button
            type="button"
            className="primary"
            data-testid="spin-button"
            onClick={() => draw(team.pendingSpin?.spinId)}
          >
            Ziehung abschließen
          </button>
        </div>
      )}

      {phase.kind === 'idle' && !team.pendingSpin && (
        <div className="actions center">
          <button
            type="button"
            className="primary big"
            data-testid="spin-button"
            disabled={activeCount === 0}
            onClick={() => draw()}
          >
            Ziehung starten
          </button>
        </div>
      )}

      {phase.kind === 'drawing' && (
        <p className="muted center">Ergebnis wird festgelegt und protokolliert …</p>
      )}

      {phase.kind === 'animating' && (
        <div className="actions center">
          <button type="button" data-testid="skip-animation" onClick={finish}>
            Überspringen
          </button>
        </div>
      )}

      {phase.kind === 'announced' && result?.reveal && (
        <section className="announcement" aria-live="assertive">
          <p className="label light">Nächster Halt</p>
          <p className="announcement-stop">Verantwortung</p>
          <p className="label light">Schuldig</p>
          <p className="announcement-name" data-testid="result-name">
            {result.selectedName}
          </p>
          <p className="announcement-meta">
            Zug SR {String(result.nonce).padStart(4, '0')} · Wahrscheinlichkeit{' '}
            {Math.round(
              (100 *
                (result.participants.find((p) => p.memberId === result.reveal?.selectedMemberId)
                  ?.weight ?? 0)) /
                result.participants.reduce((s, p) => s + p.weight, 0),
            )}{' '}
            %
          </p>
          <div className="actions">
            <a
              className="button primary"
              data-testid="open-report"
              href={href.bericht(team.teamId, result.reveal.selectedMemberId)}
            >
              Schuldbericht öffnen
            </a>
            <a className="button ghost" href={href.ziehung(team.teamId, result.spinId)}>
              Einspruch / Nachweis
            </a>
            <button type="button" className="ghost" onClick={() => setPhase({ kind: 'idle' })}>
              Nächste Ziehung
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function previewParticipants(team: TeamView, poolId: string) {
  const pool = team.pools.find((p) => p.poolId === poolId);
  return team.members
    .filter((m) => m.active && (!pool || pool.memberIds.includes(m.memberId)))
    .map((m) => ({
      memberId: m.memberId,
      name: m.name,
      weight: team.immunities.some((i) => i.memberId === m.memberId) ? 0 : 1,
    }));
}
