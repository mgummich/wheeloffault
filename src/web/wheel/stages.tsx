import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import type { SpinView } from '../../domain/views.ts';
import { percent } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { DURATION_MS, ease, seedNumberFor, trainDelayFor, trainKindFor } from './anim.ts';

export type Participant = { memberId: string; name: string; weight: number };
/** The persisted spin plus the winner's display name; every visualization animates towards it. */
export type StageResult = SpinView & { selectedName: string };

type StageProps = {
  participants: Participant[];
  result: StageResult | null;
  announced: boolean;
  poolLabel: string | null;
  onFinished: () => void;
};

const mono = 'ui-monospace,Menlo,Consolas,monospace';

/**
 * Shared clock for the non-wheel visualizations: eases through a fixed
 * sequence of names that ends on the persisted winner, then announces.
 */
function useNameTicker(
  participants: Participant[],
  result: StageProps['result'],
  announced: boolean,
  onFinished: () => void,
) {
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const [tick, setTick] = useState(0);
  const N = 26;

  const seq = useMemo(() => {
    if (!result?.reveal) return [];
    const wi = participants.findIndex((p) => p.memberId === result.reveal?.selectedMemberId);
    if (wi < 0 || participants.length === 0) return [];
    const len = participants.length;
    const off = (((wi - (N - 1)) % len) + len) % len;
    return Array.from({ length: N }, (_, i) => participants[(i + off) % len]?.memberId ?? '');
  }, [result, participants]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the result only — the animation must not restart on unrelated re-renders.
  useEffect(() => {
    if (!result) {
      setTick(0);
      return;
    }
    if (reduced) {
      setTick(N - 1);
      onFinished();
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / DURATION_MS);
      if (t >= 1) {
        setTick(N - 1);
        onFinished();
        return;
      }
      setTick(Math.floor(ease('standard', t) * (N - 1)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  const animating = result !== null && !announced;
  const currentId = announced
    ? (result?.reveal?.selectedMemberId ?? null)
    : animating
      ? (seq[Math.min(tick, seq.length - 1)] ?? null)
      : null;
  return { currentId, animating, tick };
}

export function BoardStage(props: StageProps) {
  const { t } = useI18n();
  const { participants, result, announced, poolLabel } = props;
  const { currentId, animating, tick } = useNameTicker(
    participants,
    result,
    announced,
    props.onFinished,
  );
  const name = currentId
    ? (participants.find((p) => p.memberId === currentId)?.name ?? '')
    : t('wheel.ready');
  const cellsOf = (s: string, n = 16) => s.toUpperCase().padEnd(n, ' ').slice(0, n).split('');
  const flapKey = tick + (announced ? 'f' : animating ? 'a' : 'i');
  const cell = (c: string, i: number, big: boolean) => (
    <span
      key={`${flapKey}-${i}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: big ? 26 : 16,
        height: big ? 40 : 24,
        background: announced && currentId ? '#3A1420' : '#2B3037',
        color: '#F7F7F5',
        borderRadius: 3,
        fontSize: big ? 22 : 12,
        fontWeight: 700,
        fontFamily: mono,
        animation: animating || announced ? 'sr-flap .16s ease-out' : 'none',
        transformOrigin: 'center',
        overflow: 'hidden',
      }}
    >
      {c === ' ' ? '' : c}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 1,
          background: 'rgba(0,0,0,.55)',
        }}
      />
    </span>
  );
  return (
    <div style={{ background: '#1F2327', borderRadius: 4, padding: '20px 16px', color: '#F7F7F5' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: '#B8BEC6',
          marginBottom: 12,
        }}
      >
        <span>{t('wheel.nextStop')}</span>
        <span>{t('wheel.poolPrefix', { pool: poolLabel ?? t('common.all') })}</span>
      </div>
      <div
        style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'nowrap', overflow: 'hidden' }}
      >
        {cellsOf(t('wheel.responsibility'), 16).map((c, i) => cell(c, i, false))}
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {cellsOf(name).map((c, i) => cell(c, i, true))}
      </div>
      <p style={{ margin: '14px 0 0', fontSize: 12, color: '#B8BEC6' }}>
        {announced
          ? t('wheel.boardArrived')
          : animating
            ? t('wheel.boardUpdating')
            : t('wheel.boardReady')}
      </p>
    </div>
  );
}

export function SignalStage(props: StageProps) {
  const { t } = useI18n();
  const { participants, result, announced } = props;
  const { currentId, animating } = useNameTicker(participants, result, announced, props.onFinished);
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {participants.map((p) => {
        const hot = p.memberId === currentId;
        const stop = announced && hot;
        return (
          <li
            key={p.memberId}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px minmax(0,1fr) auto',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
              borderRadius: 4,
              background: stop ? '#FBE9EE' : hot ? '#F1F2F4' : 'transparent',
              border: `1px solid ${stop ? '#F0C3CF' : 'transparent'}`,
              transition: 'background .12s',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: stop ? '#EC0016' : hot && animating ? '#C97A00' : '#1E7A46',
                boxShadow: stop ? '0 0 0 4px #F0C3CF' : 'none',
                transition: 'background .12s',
              }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span
                style={{
                  fontWeight: stop ? 700 : 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {p.name}
              </span>
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  background: hot ? '#1F2327' : '#D9DDE2',
                  position: 'relative',
                  minWidth: 24,
                  transition: 'background .12s',
                }}
              >
                {hot && (
                  <span
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: -5,
                      width: 22,
                      height: 12,
                      background: '#1F2327',
                      borderRadius: 2,
                    }}
                  />
                )}
              </span>
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: stop ? '#EC0016' : hot && animating ? '#8A4B00' : '#1E7A46',
                whiteSpace: 'nowrap',
              }}
            >
              {stop
                ? t('wheel.signalStop')
                : hot && animating
                  ? t('wheel.signalSwitch')
                  : t('wheel.signalClear')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function StampStage(props: StageProps) {
  const { t } = useI18n();
  const { participants, result, announced } = props;
  const { currentId, animating } = useNameTicker(participants, result, announced, props.onFinished);
  const total = participants.reduce((s, p) => s + p.weight, 0) || 1;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
        gap: 12,
      }}
    >
      {participants.map((p) => {
        const hot = p.memberId === currentId;
        const hit = announced && hot;
        return (
          <div
            key={p.memberId}
            style={{
              position: 'relative',
              padding: '14px 14px 12px',
              border: `1px ${hot && !hit ? 'dashed #EC0016' : 'solid #D9DDE2'}`,
              borderRadius: 4,
              background: '#fff',
              minHeight: 92,
              transition: 'border-color .12s',
              transform: hot && animating ? 'translateY(-2px)' : 'none',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 10,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: '#5C646C',
              }}
            >
              {t('wheel.ticketLabel')}
            </p>
            <p
              style={{
                margin: '6px 0 0',
                fontWeight: 700,
                fontSize: 15,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#5C646C' }}>
              {percent(p.weight / total)}
            </p>
            {hit && (
              <span
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 22,
                  padding: '4px 8px',
                  border: '3px solid #EC0016',
                  borderRadius: 4,
                  color: '#EC0016',
                  fontWeight: 800,
                  fontSize: 14,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  transform: 'rotate(-8deg)',
                  animation: 'sr-stamp .45s cubic-bezier(.2,.8,.2,1) both',
                  background: 'rgba(255,255,255,.85)',
                }}
              >
                {t('common.guilty')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TrainStage(props: StageProps) {
  const { t } = useI18n();
  const { participants, result, announced, poolLabel } = props;
  const { currentId, animating } = useNameTicker(participants, result, announced, props.onFinished);
  const seedNum = result ? seedNumberFor(result) : 0;
  const kind = trainKindFor(seedNum);
  const delay = trainDelayFor(seedNum);
  const moving = animating;
  const arrived = announced;
  const currentName = currentId
    ? (participants.find((p) => p.memberId === currentId)?.name ?? '')
    : null;
  const headerText =
    moving || arrived
      ? `${kind.code} · ${kind.name}${delay ? ` · +${delay} min` : ''}`
      : t('wheel.trainUnknown');
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 4,
        border: '1px solid #D9DDE2',
        background: '#fff',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid #E3E6EA',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: '#5C646C',
        }}
      >
        <span>{t('wheel.poolPrefix', { pool: poolLabel ?? t('common.all') })}</span>
        <span
          style={{
            fontWeight: 700,
            color: moving || arrived ? kind.color : '#5C646C',
            textTransform: 'none',
            letterSpacing: 0,
            fontSize: 14,
          }}
        >
          {headerText}
        </span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 170,
          overflow: 'hidden',
          background: 'linear-gradient(#fff 0 68%, #EEF0F2 68% 100%)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 138,
            height: 3,
            background: '#8A9199',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 146,
            height: 3,
            background: '#8A9199',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 132,
            display: 'flex',
            gap: 22,
            padding: '0 6px',
            overflow: 'hidden',
          }}
        >
          {Array.from({ length: 40 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static decoration, order never changes.
            <span key={i} style={{ flex: 'none', width: 8, height: 22, background: '#B8BEC6' }} />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 34,
            left: arrived || moving ? 16 : 'calc(100% + 40px)',
            display: 'flex',
            alignItems: 'flex-end',
            transition: moving ? `left ${DURATION_MS}ms cubic-bezier(.1,.6,.05,1)` : 'none',
            willChange: 'left',
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.18))',
          }}
        >
          {Array.from({ length: kind.n }, (_, i) => `trains/${kind.set}-${i}.png`).map((src) => (
            <img
              key={src}
              src={src}
              alt=""
              draggable={false}
              style={{
                display: 'block',
                flex: 'none',
                width: 'min(440px, 80vw)',
                height: 'auto',
                marginRight: -1,
              }}
            />
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 26,
            padding: '0 10px',
            background: '#1F2327',
            borderRadius: 3,
            fontFamily: mono,
            fontSize: 13,
            fontWeight: 700,
            maxWidth: 'calc(100% - 24px)',
            boxSizing: 'border-box',
            zIndex: 2,
          }}
        >
          <span style={{ fontSize: 10, color: '#B8BEC6', fontWeight: 600 }}>
            {t('wheel.targetLabel')}
          </span>
          <span
            key={(currentName ?? '') + (arrived ? 'f' : 'a')}
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: arrived ? '#FFB84D' : '#F7F7F5',
              animation: moving || arrived ? 'sr-flap .18s ease-out' : 'none',
            }}
          >
            {currentName ?? (moving ? '…' : t('wheel.trainExpected'))}
          </span>
        </div>
      </div>
      <p
        style={{
          margin: 0,
          padding: '10px 16px',
          fontSize: 12,
          color: '#5C646C',
          borderTop: '1px solid #E3E6EA',
        }}
      >
        {arrived
          ? `${t('wheel.trainArrived', { name: kind.name })} ${delay ? t('wheel.trainDelay', { min: delay }) : t('wheel.trainOnTime')} ${kind.note}`
          : moving
            ? t('wheel.trainMoving')
            : t('wheel.trainIdle')}
      </p>
    </div>
  );
}

export function TimetableStage(props: StageProps) {
  const { participants, result, announced } = props;
  const { currentId, animating } = useNameTicker(participants, result, announced, props.onFinished);
  const total = participants.reduce((s, p) => s + p.weight, 0) || 1;
  const rowH = 48;
  const n = participants.length;
  const ci = Math.max(
    0,
    participants.findIndex((p) => p.memberId === (result?.reveal?.selectedMemberId ?? currentId)),
  );
  const rows: number[] = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i < n; i++) rows.push(i);
  for (let i = 0; i <= ci; i++) rows.push(i);
  const target = animating || announced ? rows.length - 1 : 1;
  const y = -(target - 1) * rowH;
  return (
    <div
      style={{
        position: 'relative',
        height: rowH * 3,
        overflow: 'hidden',
        borderRadius: 4,
        border: '1px solid #D9DDE2',
        background: '#fff',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: rowH,
          height: rowH,
          borderTop: `2px solid ${announced ? '#EC0016' : '#1F2327'}`,
          borderBottom: `2px solid ${announced ? '#EC0016' : '#1F2327'}`,
          background: announced ? 'rgba(236,0,22,.06)' : 'transparent',
          zIndex: 2,
          pointerEvents: 'none',
          transition: 'border-color .3s',
        }}
      />
      <div
        style={{
          transform: `translateY(${y}px)`,
          transition: animating ? `transform ${DURATION_MS}ms cubic-bezier(.1,.7,.1,1)` : 'none',
        }}
      >
        {rows.map((i, k) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed synthetic rows, order never changes.
            key={k}
            style={{
              height: rowH,
              display: 'grid',
              gridTemplateColumns: '80px minmax(0,1fr) auto',
              gap: 12,
              alignItems: 'center',
              padding: '0 16px',
              borderBottom: '1px solid #EEF0F2',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ fontFamily: mono, fontSize: 13, color: '#5C646C' }}>
              {`${String(8 + Math.floor(k / 4)).padStart(2, '0')}:${String((k * 15) % 60).padStart(2, '0')}`}
            </span>
            <span
              style={{
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {participants[i]?.name}
            </span>
            <span style={{ fontSize: 12, color: '#5C646C' }}>
              {percent((participants[i]?.weight ?? 0) / total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LineStage(props: StageProps) {
  const { t } = useI18n();
  const { participants, result, announced } = props;
  const { animating } = useNameTicker(participants, result, announced, props.onFinished);
  // Mirror the domain's selectParticipant exactly (draw.ts): participants in
  // memberId order, needle at (first 64 digest bits) mod total weight — so the
  // needle visibly stops inside the winner's segment.
  const sorted = [...participants].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
  const total = sorted.reduce((s, p) => s + p.weight, 0) || 1;
  const segs = sorted.map((p, i) => ({ w: p.weight / total, i, p }));
  const ci = announced
    ? sorted.findIndex((p) => p.memberId === result?.reveal?.selectedMemberId)
    : -1;
  const frac = result?.reveal
    ? Number(BigInt(`0x${result.reveal.digest.slice(0, 16)}`) % BigInt(total)) / total
    : 0;
  const pos = animating || announced ? frac * 100 : 0;
  const segBg = (i: number) => (announced && i === ci ? '#EC0016' : i % 2 ? '#E3E6EA' : '#F1F2F4');
  return (
    <div style={{ padding: '28px 8px 8px' }}>
      <div style={{ position: 'relative', height: 44 }}>
        <div
          style={{
            display: 'flex',
            height: 44,
            borderRadius: 4,
            overflow: 'hidden',
            border: '1px solid #B8BEC6',
          }}
        >
          {segs.map((g) => (
            <div
              key={g.p.memberId}
              title={g.p.name}
              style={{
                width: `${g.w * 100}%`,
                background: segBg(g.i),
                borderRight: '1px solid #fff',
                transition: 'background .3s',
              }}
            />
          ))}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -22,
            left: `${pos}%`,
            transform: 'translateX(-50%)',
            transition: animating ? `left ${DURATION_MS}ms cubic-bezier(.1,.7,.1,1)` : 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '12px solid #1F2327',
            }}
          />
          <span style={{ width: 3, height: 56, background: '#1F2327', marginTop: -1 }} />
        </div>
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: '16px 0 0',
          padding: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))',
          gap: 6,
          fontSize: 13,
        }}
      >
        {segs.map((g) => {
          const win = announced && g.i === ci;
          const itemStyle: CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: win ? 700 : 500,
            color: win ? '#EC0016' : '#1F2327',
          };
          return (
            <li key={g.p.memberId} style={itemStyle}>
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: win ? '#EC0016' : segBg(g.i),
                  border: '1px solid #B8BEC6',
                }}
              />
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {g.p.name}
              </span>
              <span style={{ marginLeft: 'auto', color: '#5C646C' }}>{percent(g.w)}</span>
            </li>
          );
        })}
      </ul>
      <p style={{ margin: '12px 0 0', fontSize: 12, color: '#5C646C' }}>{t('wheel.lineNote')}</p>
    </div>
  );
}
