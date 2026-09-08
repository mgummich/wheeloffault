import type { SpinView } from '../domain/views.ts';
import { dateTime, percent, probabilityOf, spinLabel } from './format.ts';
import { t } from './i18n/index.ts';

export type RevealedSpin = SpinView & { reveal: NonNullable<SpinView['reveal']> };

export function shareText(teamName: string, spin: RevealedSpin, name: string): string {
  const prob = percent(probabilityOf(spin.participants, spin.reveal.selectedMemberId));
  return t('share.text', {
    spin: spinLabel(spin.nonce),
    name,
    prob,
    team: teamName,
    date: dateTime(spin.reveal.revealedAt),
    commit: spin.commitment.slice(0, 12),
  });
}

export function shareFileName(spin: RevealedSpin): string {
  return `schuldrad-${spinLabel(spin.nonce).replace(/\s+/g, '-')}.png`;
}

/** Reads a CSS custom property's resolved value (e.g. "#1f2327"). The share
 * card is styled like the split-flap board, whose colors are fixed "always
 * dark" chrome (see styles.css) — but reading them via CSS vars keeps this
 * canvas from re-declaring hex literals of its own. Falls back for
 * environments without a document (e.g. server-side rendering). */
function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 1200×630 result card for the Teams chat. Always rendered in the fixed
 * "indicator board" palette (--board-*), regardless of the active app theme —
 * matching the split-flap board look everywhere else in the UI. */
export function renderShareCard(teamName: string, spin: RevealedSpin, name: string): Promise<Blob> {
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return Promise.reject(new Error(t('share.canvasUnavailable')));
  const prob = percent(probabilityOf(spin.participants, spin.reveal.selectedMemberId));
  const when = dateTime(spin.reveal.revealedAt);
  const F = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  const M = 'ui-monospace, Menlo, Consolas, monospace';

  const boardBg = cssVar('--board-bg', '#1f2327');
  const boardText = cssVar('--board-text', '#f7f7f5');
  const boardTextMuted = cssVar('--board-text-muted', '#b8bec6');
  const boardAccent = cssVar('--board-accent', '#ffb84d');
  const accent = cssVar('--accent', '#ec0016');
  const tileBg = '#2b3037';
  const hairline = 'rgba(0,0,0,.55)';
  const rule = '#3a4147';

  g.fillStyle = boardBg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 14);

  g.fillStyle = boardText;
  g.font = `700 30px ${F}`;
  g.fillText('SCHULDRAD', 72, 96);
  g.fillStyle = boardTextMuted;
  g.font = `600 22px ${F}`;
  g.fillText(
    t('share.cardTeamZug', { team: teamName.toUpperCase(), spin: spinLabel(spin.nonce) }),
    72,
    136,
  );
  g.font = `600 24px ${F}`;
  g.fillText(t('share.cardNextStop'), 72, 226);

  // Name as split-flap tiles.
  const cells = [...name.toUpperCase()].slice(0, 18);
  const tw = Math.min(88, Math.floor(1056 / Math.max(cells.length, 10)));
  let x = 72;
  const y = 252;
  const th = 110;
  for (const ch of cells) {
    g.fillStyle = tileBg;
    g.fillRect(x, y, tw - 6, th);
    g.fillStyle = hairline;
    g.fillRect(x, y + th / 2 - 1, tw - 6, 2);
    if (ch !== ' ') {
      g.fillStyle = boardAccent;
      g.font = `700 ${Math.floor(tw * 1.05)}px ${M}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, x + (tw - 6) / 2, y + th / 2 + 4);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    }
    x += tw;
  }

  g.fillStyle = boardText;
  g.font = `600 28px ${F}`;
  g.fillText(t('share.cardGuiltyProb', { prob }), 72, 420);
  g.fillStyle = boardTextMuted;
  g.font = `400 22px ${F}`;
  g.fillText(t('share.cardWhenNote', { when }), 72, 462);
  g.strokeStyle = rule;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(72, 520);
  g.lineTo(W - 72, 520);
  g.stroke();
  g.fillStyle = boardTextMuted;
  g.font = `400 20px ${M}`;
  g.fillText(
    `commit ${spin.commitment.slice(0, 24)}…   digest ${spin.reveal.digest.slice(0, 16)}…`,
    72,
    566,
  );

  g.fillStyle = accent;
  g.beginPath();
  g.arc(W - 112, 96, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = boardBg;
  g.beginPath();
  g.arc(W - 112, 96, 9, 0, Math.PI * 2);
  g.fill();

  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('share.pngExportFailed')))),
      'image/png',
    );
  });
}
