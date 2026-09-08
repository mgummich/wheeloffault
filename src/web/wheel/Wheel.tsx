import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpinStyle, WheelStyle } from '../animSettings.ts';
import { useI18n } from '../i18n/index.ts';
import { DURATION_MS, ease, hashHex, targetRotation } from './anim.ts';
import type { Participant, StageResult } from './stages.tsx';
import { useReducedMotion } from './useReducedMotion.ts';

type Props = {
  participants: Participant[];
  /** The persisted result. The wheel only ever animates towards it. */
  result: StageResult | null;
  announced: boolean;
  wheelStyle: WheelStyle;
  spinStyle: SpinStyle;
  tickSound: boolean;
  onFinished: () => void;
};

const R = 120;

const statusKeys = [
  'wheel.status1',
  'wheel.status2',
  'wheel.status3',
  'wheel.status4',
  'wheel.status5',
  'wheel.status6',
] as const;

type Theme = {
  bg: string;
  segs: string[];
  text: string;
  win: string | null;
  winText: string;
  stroke: string;
  hub: string;
  hubStroke: string;
  pointer: string;
  confetti: boolean;
};

const themes: Record<WheelStyle, Theme> = {
  db: {
    bg: 'transparent',
    segs: ['#F1F2F4', '#E3E6EA'],
    text: '#1F2327',
    win: '#EC0016',
    winText: '#fff',
    stroke: '#fff',
    hub: '#fff',
    hubStroke: '#B8BEC6',
    pointer: '#EC0016',
    confetti: false,
  },
  bunt: {
    bg: 'transparent',
    segs: ['#3369E8', '#D50F25', '#EEB211', '#009925'],
    text: '#fff',
    win: null,
    winText: '#fff',
    stroke: '#fff',
    hub: '#fff',
    hubStroke: '#1F2327',
    pointer: '#1F2327',
    confetti: true,
  },
  nacht: {
    bg: '#1F2327',
    segs: ['#1E3A5F', '#243B53', '#334E68', '#2B4C7E'],
    text: '#F7F7F5',
    win: '#FFB84D',
    winText: '#1F2327',
    stroke: '#1F2327',
    hub: '#1F2327',
    hubStroke: '#8A9199',
    pointer: '#FFB84D',
    confetti: false,
  },
  pastell: {
    bg: 'transparent',
    segs: ['#FBD5D5', '#FDE8C8', '#D6EFD8', '#D4E4F7', '#E8D9F5'],
    text: '#1F2327',
    win: '#EC0016',
    winText: '#fff',
    stroke: '#fff',
    hub: '#fff',
    hubStroke: '#B8BEC6',
    pointer: '#1F2327',
    confetti: true,
  },
};

function arcPath(start: number, end: number): string {
  if (end - start >= 359.9) return `M0,-${R}A${R},${R},0,1,1,0,${R}A${R},${R},0,1,1,0,-${R}Z`;
  const rad = (d: number) => (d * Math.PI) / 180;
  const x1 = R * Math.sin(rad(start));
  const y1 = -R * Math.cos(rad(start));
  const x2 = R * Math.sin(rad(end));
  const y2 = -R * Math.cos(rad(end));
  return `M0,0L${x1.toFixed(2)},${y1.toFixed(2)}A${R},${R},0,${end - start > 180 ? 1 : 0},1,${x2.toFixed(2)},${y2.toFixed(2)}Z`;
}

export function Wheel({
  participants,
  result,
  announced,
  wheelStyle,
  spinStyle,
  tickSound,
  onFinished,
}: Props) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const drawn = participants.filter((p) => p.weight > 0);
  const total = drawn.reduce((s, p) => s + p.weight, 0);
  const theme = themes[wheelStyle];
  const pointerDeg = wheelStyle === 'bunt' ? 90 : 0;

  // Segment angles are proportional to the committed weights.
  const segments = useMemo(() => {
    let cursor = 0;
    return drawn.map((p, i) => {
      const span = total === 0 ? 360 / drawn.length : (p.weight / total) * 360;
      const seg = { ...p, start: cursor, end: cursor + span, index: i };
      cursor += span;
      return seg;
    });
  }, [drawn, total]);

  const winnerIndex = result
    ? segments.findIndex((s) => s.memberId === result.reveal?.selectedMemberId)
    : -1;

  const [rotation, setRotation] = useState(0);
  const [kickAt, setKickAt] = useState(0);
  const [status, setStatus] = useState(0);
  const [finished, setFinished] = useState(false);
  // Refs mirror state for the animation-frame closure below, which must not restart on re-renders.
  const rotationRef = useRef(0);
  rotationRef.current = rotation;
  const targetRef = useRef<number | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const tickRef = useRef(tickSound);
  tickRef.current = tickSound;
  const finishedRef = useRef(false);
  finishedRef.current = finished || announced;

  const click = () => {
    if (!tickRef.current) return;
    try {
      audioRef.current = audioRef.current ?? new AudioContext();
      const ac = audioRef.current;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = 900;
      gain.gain.setValueAtTime(0.06, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.04);
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.05);
    } catch {}
  };

  const segAt = (rot: number): number => {
    const ang = (((pointerDeg - rot) % 360) + 360) % 360;
    for (const s of segments) if (ang < s.end) return s.index;
    return segments.length - 1;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the result only — the spin must not restart on unrelated re-renders.
  useEffect(() => {
    setFinished(false);
    if (!result || winnerIndex < 0) {
      setRotation(0);
      return;
    }
    const target = segments[winnerIndex];
    if (!target) return;
    const mid = (target.start + target.end) / 2;
    const from = ((rotationRef.current % 360) + 360) % 360;
    const to = targetRotation(from, mid, pointerDeg, spinStyle);
    targetRef.current = to;
    const finish = () => {
      setRotation(to);
      setFinished(true);
      onFinished();
    };
    if (reduced) {
      finish();
      return;
    }
    setRotation(from);
    const start = performance.now();
    let lastSeg = -1;
    let raf = 0;
    const step = () => {
      if (finishedRef.current) return;
      const t = Math.min(1, (performance.now() - start) / DURATION_MS);
      if (t >= 1) {
        finish();
        return;
      }
      const rot = from + (to - from) * ease(spinStyle, t);
      setRotation(rot);
      const seg = segAt(rot);
      if (seg !== lastSeg) {
        // The pointer "kicks" on every boundary passing underneath it.
        if (lastSeg >= 0) {
          setKickAt(performance.now());
          click();
        }
        lastSeg = seg;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const ticker = setInterval(() => setStatus((s) => s + 1), 1100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(ticker);
    };
  }, [result]);

  // "Überspringen" flips the page to announced while the loop still runs: snap to the end.
  useEffect(() => {
    if (announced && !finished) {
      setFinished(true);
      if (targetRef.current !== null) setRotation(targetRef.current);
    }
  }, [announced, finished]);

  const spinning = result !== null && !finished && !announced;
  const done = result !== null && (finished || announced);
  const kick = spinning ? Math.max(0, 1 - (performance.now() - kickAt) / 140) : 0;
  const kickDeg = kick * kick * 22;
  const excluded = participants.filter((p) => p.weight === 0);

  const confetti =
    done && theme.confetti && !reduced && result ? (
      <div className="confetti" aria-hidden="true" key={`cf${result.spinId}`}>
        {Array.from({ length: 110 }, (_, i) => {
          const r = hashHex(`cf${result.spinId}|${i * 31}`, 8);
          const x = (Number.parseInt(r.slice(0, 2), 16) / 255) * 100;
          const dx = (Number.parseInt(r.slice(2, 4), 16) / 255 - 0.5) * 260;
          const delay = (Number.parseInt(r.slice(4, 6), 16) / 255) * 0.6;
          const duration = 1.6 + (Number.parseInt(r.slice(6, 8), 16) / 255) * 1.2;
          const raw = theme.segs[i % theme.segs.length] ?? '#EC0016';
          const color = raw === '#F1F2F4' ? '#EC0016' : raw;
          return (
            <span
              key={r}
              style={{
                left: `${x}%`,
                width: i % 3 ? 10 : 7,
                height: i % 2 ? 16 : 9,
                background: color,
                borderRadius: i % 4 ? 1 : '50%',
                ['--dx' as string]: `${dx}px`,
                animation: `sr-confetti ${duration}s cubic-bezier(.2,.6,.4,1) ${delay}s both`,
              }}
            />
          );
        })}
      </div>
    ) : null;

  return (
    <div className="wheel-wrap">
      {/* Decorative status ticker: deliberately NOT a live region — the result has its own announcement. */}
      <div className="board-strip">
        <span className="label">{t('common.train')}</span>
        <span>SR {result ? String(result.nonce).padStart(4, '0') : '––––'}</span>
        <span className="label">{t('wheel.toLabel')}</span>
        <span>{t('common.responsibility')}</span>
        <span className="label">{t('common.status')}</span>
        <span className={spinning ? 'blink' : ''}>
          {!result
            ? t('wheel.departureReady')
            : done
              ? t('wheel.arrivedShort')
              : t(statusKeys[status % statusKeys.length] ?? 'wheel.status1')}
        </span>
      </div>
      <div
        className="wheel-stage"
        style={{
          background: theme.bg,
          borderRadius: theme.bg === 'transparent' ? 0 : 8,
          padding: theme.bg === 'transparent' ? 0 : 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            pointerEvents: 'none',
            transform: `rotate(${pointerDeg}deg)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 'calc(50% - 11px)',
              top: -4,
              width: 0,
              height: 0,
              borderLeft: '11px solid transparent',
              borderRight: '11px solid transparent',
              borderTop: `22px solid ${theme.pointer}`,
              transformOrigin: '50% 0',
              transform: `rotate(${-kickDeg}deg)`,
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.3))',
            }}
          />
        </div>
        {confetti}
        <svg
          viewBox="-130 -130 260 260"
          className="wheel"
          style={{ transform: `rotate(${rotation}deg)` }}
          role="img"
          aria-label={t('wheel.ariaLabel', { n: segments.length })}
        >
          {segments.map((s) => {
            const isWinner = done && s.index === winnerIndex;
            const baseFill = theme.segs[s.index % theme.segs.length] ?? theme.segs[0];
            const fill = isWinner ? (theme.win ?? baseFill) : baseFill;
            const textFill =
              baseFill === '#EEB211' && !theme.win
                ? '#1F2327'
                : isWinner
                  ? theme.winText
                  : theme.text;
            return (
              <g key={s.memberId}>
                <path
                  d={arcPath(s.start, s.end)}
                  fill={fill}
                  stroke={theme.stroke}
                  strokeWidth={1.5}
                  style={{
                    transition: 'fill .3s, opacity .4s',
                    opacity: done && s.index !== winnerIndex && !theme.win ? 0.35 : 1,
                  }}
                />
                <g transform={`rotate(${(s.start + s.end) / 2})`}>
                  <text
                    transform="rotate(-90)"
                    x={112}
                    y={4}
                    textAnchor="end"
                    fontSize={11}
                    fontWeight={600}
                    fill={textFill}
                  >
                    {s.name.length > 15 ? `${s.name.slice(0, 14)}…` : s.name}
                  </text>
                </g>
              </g>
            );
          })}
          <circle r={16} fill={theme.hub} stroke={theme.hubStroke} strokeWidth={2} />
          <circle r={4} fill={theme.hubStroke === '#8A9199' ? '#F7F7F5' : '#1F2327'} />
        </svg>
      </div>
      {excluded.length > 0 && (
        <p className="muted small">
          {t('wheel.excluded', { names: excluded.map((p) => p.name).join(', ') })}
        </p>
      )}
    </div>
  );
}
