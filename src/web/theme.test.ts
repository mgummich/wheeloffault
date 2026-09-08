import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Parses the real token values out of styles.css rather than hardcoding
// hex expectations here — this test breaks if the CSS drifts out of AA
// compliance, not just if someone forgets to update a duplicate.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

function extractTokens(selectorRe: RegExp): Record<string, string> {
  const block = selectorRe.exec(css);
  if (!block) throw new Error(`selector not found: ${selectorRe}`);
  const body = block[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
    tokens[m[1] as string] = (m[2] as string).toLowerCase();
  }
  return tokens;
}

// :root { ... } — the first rule in the file, light theme + fixed brand/board tokens.
const light = extractTokens(/^:root\s*\{([^}]*)\}/m);
// :root[data-theme="dark"] { ... } — dark theme overrides.
const dark = extractTokens(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
// The @media (prefers-color-scheme: dark) block duplicates the same tokens
// for system-preference dark mode (no data-theme attribute set) — it must
// be kept in sync with the block above by hand, so assert they agree.
const darkSystem = extractTokens(
  /:root:not\(\[data-theme="light"\]\):not\(\[data-theme="dark"\]\)\s*\{([^}]*)\}/,
);

/** Looks up a token, failing loudly (not with `undefined`) if it's missing. */
function tok(tokens: Record<string, string>, name: string): string {
  const v = tokens[name];
  if (!v) throw new Error(`missing token --${name}`);
  return v;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG 2.2 contrast ratio between two colors, order-independent. */
function contrast(hexA: string, hexB: string): number {
  const la = relLuminance(hexToRgb(hexA));
  const lb = relLuminance(hexToRgb(hexB));
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

// [description, foreground token, background token, minimum ratio]
const PAIR_CHECKS: [string, string, string, number][] = [
  ['body text on page background', 'text', 'bg', AA_NORMAL],
  ['muted text on page background', 'text-muted', 'bg', AA_NORMAL],
  ['body text on surface', 'text', 'surface', AA_NORMAL],
  ['body text on surface-2 (cards, inputs, dialogs)', 'text', 'surface-2', AA_NORMAL],
  ['danger text on page background', 'danger-text', 'bg', AA_NORMAL],
  ['success text on page background', 'success', 'bg', AA_NORMAL],
  ['warn text on page background', 'warn', 'bg', AA_NORMAL],
  ['link text on page background', 'link', 'bg', AA_NORMAL],
  ['border-strong (input/button/chip borders) on page background', 'border-strong', 'bg', AA_LARGE],
  ['focus ring on page background', 'focus', 'bg', AA_LARGE],
];

const BOARD_CHECKS: [string, string, string, number][] = [
  ['board-text on board-bg', 'board-text', 'board-bg', AA_NORMAL],
  ['board-text-muted on board-bg', 'board-text-muted', 'board-bg', AA_NORMAL],
  ['board-accent on board-bg', 'board-accent', 'board-bg', AA_NORMAL],
  ['accent-contrast text on accent background (buttons)', 'accent-contrast', 'accent', AA_NORMAL],
];

describe('theme contrast (WCAG 2.2 AA)', () => {
  describe.each([
    ['light', light],
    ['dark', dark],
  ])('%s theme', (_name, tokens) => {
    it.each(PAIR_CHECKS)('%s is >= the required ratio', (_desc, fg, bg, min) => {
      expect(contrast(tok(tokens, fg), tok(tokens, bg))).toBeGreaterThanOrEqual(min);
    });
  });

  it.each(BOARD_CHECKS)('board chrome: %s is >= 4.5:1', (_desc, fg, bg, min) => {
    expect(contrast(tok(light, fg), tok(light, bg))).toBeGreaterThanOrEqual(min);
  });

  it('light and dark disagree on bg (themes are actually different)', () => {
    expect(tok(light, 'bg')).not.toBe(tok(dark, 'bg'));
  });

  it('prefers-color-scheme dark block matches [data-theme="dark"] token-for-token', () => {
    expect(darkSystem).toEqual(dark);
  });
});
