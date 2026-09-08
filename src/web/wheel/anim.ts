import type { SpinStyle } from '../animSettings.ts';

/** Length of every visualization's run, from draw start to announcement. */
export const DURATION_MS = 6500;

/** Easing curves from the design handoff; t in [0,1], result reaches exactly 1. */
export function ease(style: SpinStyle, t: number): number {
  switch (style) {
    case 'overshoot': {
      const c = 1.4;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    }
    case 'windup': {
      if (t < 0.18) return -0.035 * Math.sin((t / 0.18) * (Math.PI / 2));
      const u = Math.min(1, (t - 0.18) / 0.82);
      return 1 - (1 - u) ** 3.2;
    }
    case 'lang':
      return 1 - (1 - t) ** 2.2;
    case 'stopp':
      return t >= 1 ? 1 : 1 - 2 ** (-9 * t);
    default:
      return 1 - (1 - t) ** 3.2;
  }
}

/** Extra full turns before landing; "lang" rides twice as far. */
export function extraDegrees(style: SpinStyle): number {
  return style === 'lang' ? 3600 : 1800;
}

/**
 * Absolute rotation that puts the winning segment's middle under the pointer,
 * continuing forward from the current rotation.
 */
export function targetRotation(
  from: number,
  segmentMidDeg: number,
  pointerDeg: number,
  style: SpinStyle,
): number {
  return from + extraDegrees(style) + ((((pointerDeg - segmentMidDeg - from) % 360) + 360) % 360);
}

/** Deterministic hex chars from a string (FNV-1a per character position). */
export function hashHex(input: string, chars: number): string {
  let out = '';
  let h = 0x811c9dc5;
  for (let i = 0; out.length < chars; i++) {
    h ^= input.charCodeAt(i % input.length) + i;
    h = Math.imul(h, 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, chars);
}

export type TrainKind = {
  code: string;
  name: string;
  color: string;
  set: string;
  n: number;
};

/** `set` doubles as the i18n slug for `train.<set>.note` — see stages.tsx. */
export const trainKinds: TrainKind[] = [
  { code: 'ICE', name: 'ICE 3', color: '#1F2327', set: 'ice3', n: 4 },
  { code: 'ICE', name: 'ICE 4', color: '#1F2327', set: 'ice4', n: 4 },
  { code: 'ICE', name: 'ICE Sprinter', color: '#1F2327', set: 'ice-sprinter', n: 4 },
  { code: 'ICE', name: 'ICE T', color: '#1F2327', set: 'ice-t', n: 4 },
  { code: 'ICE', name: 'ICE (Langzug)', color: '#1F2327', set: 'ice-long', n: 5 },
  { code: 'IC', name: 'Intercity 2 (Dosto)', color: '#1F2327', set: 'ic2', n: 4 },
  { code: 'RE', name: 'Regionalexpress (Flirt)', color: '#8A0C1F', set: 're-flirt', n: 4 },
  { code: 'RB', name: 'Regionalbahn (Talent 2)', color: '#8A0C1F', set: 'rb-talent', n: 4 },
  { code: 'S', name: 'S-Bahn', color: '#C8102E', set: 's-bahn', n: 4 },
  { code: 'GZ', name: 'Güterzug (gemischt)', color: '#3A4147', set: 'gz-mixed', n: 4 },
  { code: 'GZ', name: 'Güterzug (Container)', color: '#8A0C1F', set: 'gz-red', n: 4 },
];

/** Seed comes from the spin's digest/commitment, so every draw gets its own train. */
export function seedNumberFor(spin: { commitment: string; reveal: { digest: string } | null }) {
  return Number.parseInt((spin.reveal?.digest || spin.commitment).slice(12, 20), 16) || 0;
}

export function trainKindFor(seedNum: number): TrainKind {
  const kind = trainKinds[seedNum % trainKinds.length];
  if (!kind) throw new Error('unreachable: trainKinds is non-empty');
  return kind;
}

export function trainDelayFor(seedNum: number): number {
  return Math.floor(seedNum / 16) % 4 === 0 ? (Math.floor(seedNum / 64) % 40) + 5 : 0;
}
