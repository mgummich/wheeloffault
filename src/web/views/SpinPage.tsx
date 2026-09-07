import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Pool } from '../../domain/team.ts';
import type { SpinView, TeamView } from '../../server/views.ts';
import { AnimPanel } from '../AnimPanel.tsx';
import { animSummary, useAnimSettings } from '../animSettings.ts';
import { api, errorMessage } from '../api.ts';
import { performDraw } from '../draw.ts';
import { percent, probabilityOf, spinLabel } from '../format.ts';
import { RevealName } from '../RevealName.tsx';
import { href } from '../route.ts';
import { ShareDialog } from '../ShareDialog.tsx';
import {
  BoardStage,
  LineStage,
  SignalStage,
  StampStage,
  TimetableStage,
  TrainStage,
} from '../wheel/stages.tsx';
import { Wheel } from '../wheel/Wheel.tsx';

type Props = { team: TeamView; setTeam: (t: TeamView) => void; reload: () => Promise<void> };

type Phase =
  | { kind: 'idle' }
  | { kind: 'drawing' }
  | { kind: 'animating'; spin: SpinView }
  | { kind: 'announced'; spin: SpinView };

export function SpinPage({ team, reload }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [poolId, setPoolId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [settings, updateSettings] = useAnimSettings();
  const [animOpen, setAnimOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; error: boolean }[]>([]);
  const online = useOnline();

  const toast = useCallback((text: string, isError = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, error: isError }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const nameOf = (id: string) => team.members.find((m) => m.memberId === id)?.name ?? id;

  /** Commit → reveal → only then animate to the persisted result (see performDraw). */
  const draw = useCallback(
    async (resumeSpinId?: string) => {
      if (phase.kind === 'drawing') return;
      setPhase({ kind: 'drawing' });
      setError(null);
      try {
        const revealed = await performDraw(api, team.teamId, poolId || null, resumeSpinId);
        setPhase({ kind: 'animating', spin: revealed });
        void reload();
      } catch (err) {
        setError(errorMessage(err));
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

  const announced = phase.kind === 'announced';

  useEffect(() => {
    if (!result || !announced) return;
    document.title = `Schuldig: ${result.selectedName} · Schuldrad`;
    return () => {
      document.title = 'Schuldrad';
    };
  }, [result, announced]);

  // Teams card auto-opens shortly after the announcement (setting-controlled, off by default).
  useEffect(() => {
    if (!announced || !settings.autoShare || !result?.reveal) return;
    const t = setTimeout(() => setShareOpen(true), 1800);
    return () => clearTimeout(t);
  }, [announced, settings.autoShare, result]);

  const activeCount = team.members.filter((m) => m.active).length;
  const eligibility = spinEligibility(team, poolId);
  const drawnParticipants = wheelParticipants.filter((p) => p.weight > 0);
  const poolLabel = poolId ? (team.pools.find((p) => p.poolId === poolId)?.name ?? null) : null;

  const animating = phase.kind === 'animating';
  const stageProps = {
    participants: drawnParticipants,
    result: animating || announced ? result : null,
    announced,
    poolLabel,
    onFinished: finish,
  };

  const visualization =
    settings.vis === 'wheel' ? (
      <Wheel
        participants={wheelParticipants}
        result={animating || announced ? result : null}
        announced={announced}
        wheelStyle={settings.wheelStyle}
        spinStyle={settings.spinStyle}
        tickSound={settings.tickSound}
        onFinished={finish}
      />
    ) : settings.vis === 'train' ? (
      <TrainStage {...stageProps} />
    ) : settings.vis === 'board' ? (
      <BoardStage {...stageProps} />
    ) : settings.vis === 'signal' ? (
      <SignalStage {...stageProps} />
    ) : settings.vis === 'stamp' ? (
      <StampStage {...stageProps} />
    ) : settings.vis === 'timetable' ? (
      <TimetableStage {...stageProps} />
    ) : (
      <LineStage {...stageProps} />
    );

  const revealedSpin = result?.reveal ? { ...result, reveal: result.reveal } : null;
  const pending = phase.kind === 'idle' ? team.pendingSpin : null;

  // One persistent button across all phases so keyboard focus survives the
  // idle → drawing → animating → announced transitions.
  const action =
    phase.kind === 'idle'
      ? pending
        ? { label: 'Ziehung abschließen', onClick: () => draw(pending.spinId), disabled: !online }
        : {
            label: 'Ziehung starten',
            onClick: () => draw(),
            disabled: eligibility.disabled || !online,
          }
      : phase.kind === 'drawing'
        ? { label: 'Ergebnis wird festgelegt …', onClick: () => {}, disabled: true }
        : phase.kind === 'animating'
          ? { label: 'Überspringen', onClick: finish, disabled: false }
          : {
              label: 'Nächste Ziehung',
              onClick: () => setPhase({ kind: 'idle' }),
              disabled: false,
            };

  return (
    <>
      <div className="spin-head">
        <div>
          <p className="label">Team</p>
          <h1>{team.name}</h1>
        </div>
        <div className="spin-controls">
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
                  {poolOptionLabel(team, p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="anim-toggle"
            onClick={() => setAnimOpen((o) => !o)}
            aria-expanded={animOpen}
            aria-controls="sr-anim-panel"
          >
            <span className={`chevron${animOpen ? ' open' : ''}`} aria-hidden="true" />
            <span>Animation</span>
            <span className="anim-summary">{animSummary(settings)}</span>
          </button>
        </div>
      </div>

      {animOpen && <AnimPanel settings={settings} updateSettings={updateSettings} />}

      <p className={eligibility.disabled ? 'notice' : 'muted spin-context'}>
        {eligibility.message}
        {poolId && ' '}
        {poolId && <a href={href.teilnehmer(team.teamId)}>Gleis bearbeiten</a>}
      </p>

      {activeCount === 0 && (
        <p className="notice">
          Keine aktiven Teilnehmer. <a href={href.teilnehmer(team.teamId)}>Teilnehmer verwalten</a>
        </p>
      )}

      {!online && (
        <p className="notice error">
          Offline – Fahrplandaten nicht verfügbar. Eine Ziehung braucht Verbindung.
        </p>
      )}

      {visualization}

      {error && <p className="error-text">{error}</p>}

      {pending && (
        <p className="notice">
          Zug {spinLabel(pending.nonce)} läuft (festgelegt, noch nicht aufgedeckt).
        </p>
      )}

      <div className="actions center">
        <button
          type="button"
          className={phase.kind === 'animating' ? '' : 'primary big'}
          data-testid={phase.kind === 'animating' ? 'skip-animation' : 'spin-button'}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      </div>

      {/* Permanently mounted live region: many AT combos never announce the
          initial content of a freshly mounted node. */}
      <p className="visually-hidden" aria-live="assertive" role="status">
        {announced && result ? `Schuldig: ${result.selectedName}` : ''}
      </p>

      {announced && result?.reveal && (
        <section className={`announcement fx-${settings.resultFx}`} key={result.spinId}>
          <p className="label light">Nächster Halt</p>
          <p className="announcement-stop">Verantwortung</p>
          <p className="label light">Schuldig</p>
          <p className="announcement-name" data-testid="result-name">
            <span className="visually-hidden">{result.selectedName}</span>
            <RevealName name={result.selectedName} mode={settings.reveal} spinId={result.spinId} />
          </p>
          <p className="announcement-meta">
            Zug {spinLabel(result.nonce)} · Wahrscheinlichkeit{' '}
            {percent(probabilityOf(result.participants, result.reveal.selectedMemberId))}
          </p>
          <div className="actions">
            <a
              className="button primary"
              data-testid="open-report"
              href={href.bericht(team.teamId, result.reveal.selectedMemberId)}
            >
              Schuldbericht öffnen
            </a>
            <button type="button" className="ghost" onClick={() => setShareOpen(true)}>
              Für Teams teilen
            </button>
            <a className="button ghost" href={href.ziehung(team.teamId, result.spinId)}>
              Einspruch / Nachweis
            </a>
          </div>
        </section>
      )}

      {shareOpen && revealedSpin && (
        <ShareDialog
          teamName={team.name}
          spin={revealedSpin}
          selectedName={selectedName}
          onClose={() => setShareOpen(false)}
          onToast={toast}
        />
      )}

      {toasts.length > 0 && (
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} role="status" className={`toast${t.error ? ' toast-error' : ''}`}>
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/**
 * Idle-state preview of who would be on the wheel. Weights are only 1 (in)
 * or 0 (immune) — policy modifiers apply at commit time, so the preview's
 * equal segments deliberately ignore pity/cooldown/exhaustion.
 */
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

export function poolOptionLabel(team: TeamView, pool: Pool): string {
  const active = team.members.filter((m) => m.active && pool.memberIds.includes(m.memberId)).length;
  return `${pool.name} (${active} aktiv)`;
}

export function spinEligibility(team: TeamView, poolId: string) {
  const pool = team.pools.find((p) => p.poolId === poolId);
  const eligibleCount = team.members.filter(
    (m) => m.active && (!pool || pool.memberIds.includes(m.memberId)),
  ).length;
  const inactiveInPool = pool
    ? team.members.filter((m) => !m.active && pool.memberIds.includes(m.memberId)).length
    : 0;
  const participant = eligibleCount === 1 ? 'aktiver Teilnehmer' : 'aktive Teilnehmer';
  const inactiveNote = inactiveInPool > 0 ? `, ${inactiveInPool} abgemeldet` : '';
  const message = pool
    ? `${pool.name}: ${eligibleCount} ${participant} im Lostopf${inactiveNote}.`
    : `${eligibleCount} ${participant} im Lostopf.`;

  return { eligibleCount, disabled: eligibleCount === 0, message };
}
