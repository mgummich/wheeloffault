import { useEffect, useMemo, useState } from 'react';
import type { SpinView } from '../../server/views.ts';

type Props = {
  participants: { memberId: string; name: string; weight: number }[];
  /** The persisted result. The wheel only ever animates towards it. */
  result: (SpinView & { selectedName: string }) | null;
  onFinished: () => void;
};

const SIZE = 420;
const R = SIZE / 2 - 8;
const TURNS = 5;
const DURATION_MS = 6500;

const statusLines = [
  'Verspätung wird berechnet …',
  'Grund: Signalstörung im Sprint',
  'Wagenreihung abweichend',
  'Bitte beachten Sie die Durchsagen',
  'Zugbegleiter prüft Schuldzuweisung',
  'Halt auf freier Strecke',
];

function polar(angleDeg: number, r: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: SIZE / 2 + r * Math.cos(a), y: SIZE / 2 + r * Math.sin(a) };
}

function arcPath(start: number, end: number) {
  const s = polar(start, R);
  const e = polar(end, R);
  const large = end - start > 180 ? 1 : 0;
  return `M ${SIZE / 2} ${SIZE / 2} L ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

export function Wheel({ participants, result, onFinished }: Props) {
  const reduced = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const drawn = participants.filter((p) => p.weight > 0);
  const total = drawn.reduce((s, p) => s + p.weight, 0);

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

  const target = result
    ? segments.find((s) => s.memberId === result.reveal?.selectedMemberId)
    : undefined;
  const finalAngle = target ? TURNS * 360 - (target.start + target.end) / 2 : 0;

  const [rotation, setRotation] = useState(0);
  const [status, setStatus] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setFinished(false);
    if (!result) {
      setRotation(0);
      return;
    }
    const finish = () => {
      setFinished(true);
      onFinished();
    };
    if (reduced) {
      setRotation(finalAngle);
      finish();
      return;
    }
    // Two frames so the transition picks up the change from 0.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setRotation(finalAngle)));
    const done = setTimeout(finish, DURATION_MS + 200);
    const ticker = setInterval(() => setStatus((s) => s + 1), 1100);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
      clearInterval(ticker);
    };
  }, [result, finalAngle, reduced, onFinished]);

  const spinning = result !== null && !finished;
  const excluded = participants.filter((p) => p.weight === 0);

  return (
    <div className="wheel-wrap">
      <div className="board-strip" aria-live="polite">
        <span className="label">Zug</span>
        <span>SR {result ? String(result.nonce).padStart(4, '0') : '––––'}</span>
        <span className="label">Nach</span>
        <span>Verantwortung</span>
        <span className="label">Status</span>
        <span className={spinning ? 'blink' : ''}>
          {!result
            ? 'Abfahrtbereit'
            : finished
              ? 'Angekommen'
              : statusLines[status % statusLines.length]}
        </span>
      </div>
      <div className="wheel-stage">
        <div className="pointer" aria-hidden="true" />
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="wheel"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition:
              rotation === 0 || reduced
                ? 'none'
                : `transform ${DURATION_MS}ms cubic-bezier(0.12, 0.7, 0.05, 1)`,
          }}
          role="img"
          aria-label="Schuldrad"
        >
          {segments.map((s) => {
            const angle = (s.start + s.end) / 2;
            const mid = polar(angle, R * 0.66);
            // Labels in the lower half are flipped so nobody has to read upside down.
            const labelAngle = angle > 90 && angle < 270 ? angle + 180 : angle;
            // Two alternating shades; an odd last segment gets a third so it never matches the first.
            const shade =
              s.index === segments.length - 1 && segments.length % 2 === 1 ? 2 : s.index % 2;
            return (
              <g key={s.memberId}>
                <path
                  d={
                    segments.length === 1
                      ? `M ${SIZE / 2} ${SIZE / 2} m -${R} 0 a ${R} ${R} 0 1 0 ${R * 2} 0 a ${R} ${R} 0 1 0 -${R * 2} 0`
                      : arcPath(s.start, s.end)
                  }
                  className={`segment s${shade}`}
                />
                <text
                  x={mid.x}
                  y={mid.y}
                  transform={`rotate(${labelAngle} ${mid.x} ${mid.y})`}
                  className="segment-label"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
                </text>
              </g>
            );
          })}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={26} className="hub" />
        </svg>
      </div>
      {excluded.length > 0 && (
        <p className="muted small">
          Fällt aus (Gewicht 0): {excluded.map((p) => p.name).join(', ')}
        </p>
      )}
    </div>
  );
}
