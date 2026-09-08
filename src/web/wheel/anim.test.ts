import { describe, expect, it } from 'vitest';
import type { SpinStyle } from '../animSettings.ts';
import {
  ease,
  extraDegrees,
  hashHex,
  seedNumberFor,
  targetRotation,
  trainDelayFor,
  trainKindFor,
  trainKinds,
} from './anim.ts';

const styles: SpinStyle[] = ['standard', 'overshoot', 'windup', 'lang', 'stopp'];

describe('ease', () => {
  it('reaches exactly 1 at t=1 for every curve', () => {
    for (const s of styles) expect(ease(s, 1)).toBeCloseTo(1, 10);
  });

  it('starts at 0 (windup dips negative first)', () => {
    for (const s of styles) expect(Math.abs(ease(s, 0))).toBeLessThan(1e-9);
    expect(ease('windup', 0.09)).toBeLessThan(0);
  });

  it('overshoot passes beyond 1 before settling', () => {
    const peak = Math.max(
      ...Array.from({ length: 99 }, (_, i) => ease('overshoot', (i + 1) / 100)),
    );
    expect(peak).toBeGreaterThan(1);
  });
});

describe('targetRotation', () => {
  it('lands the segment middle under the pointer, whole turns ahead', () => {
    for (const s of styles) {
      const to = targetRotation(37, 123, 0, s);
      expect(to).toBeGreaterThanOrEqual(37 + extraDegrees(s));
      // Final wheel rotation puts the segment middle at the pointer angle.
      expect((((0 - 123 - to) % 360) + 360) % 360).toBeCloseTo(0, 8);
    }
  });
});

describe('train kinds', () => {
  it('selects deterministically from the seed and covers all eleven sets', () => {
    expect(trainKinds).toHaveLength(11);
    const seed = seedNumberFor({ commitment: 'a'.repeat(64), reveal: { digest: 'f'.repeat(64) } });
    expect(trainKindFor(seed)).toBe(trainKindFor(seed));
    const picked = new Set(Array.from({ length: 200 }, (_, i) => trainKindFor(i).set));
    expect(picked.size).toBe(11);
  });

  it('delay is 0 or within 5–44 minutes, and both cases actually occur', () => {
    let sawZero = false;
    let sawNonZero = false;
    for (let i = 0; i < 500; i++) {
      const d = trainDelayFor(i);
      if (d === 0) {
        sawZero = true;
      } else {
        sawNonZero = true;
        expect(d).toBeGreaterThanOrEqual(5);
        expect(d).toBeLessThanOrEqual(44);
      }
    }
    expect(sawZero).toBe(true);
    expect(sawNonZero).toBe(true);
  });
});

describe('hashHex', () => {
  it('is deterministic and hex of the requested length', () => {
    expect(hashHex('x', 8)).toBe(hashHex('x', 8));
    expect(hashHex('confetti|1', 8)).toMatch(/^[0-9a-f]{8}$/);
    expect(hashHex('a', 8)).not.toBe(hashHex('b', 8));
  });
});
