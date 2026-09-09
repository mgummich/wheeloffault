import { expect, test } from '@playwright/test';
import type { Vis } from '../../src/web/animSettings.ts';
import {
  buildSessionEvents,
  CLIENT_SEED,
  EXPECTED_WINNER,
  SPIN_ID,
  TEAM_ID,
} from './fixtures/deterministicDraw.ts';

/**
 * Visual regression coverage for the six non-wheel visualizations
 * (src/web/wheel/stages.tsx) plus the wheel itself (Wheel.tsx), in both
 * themes.
 *
 * Determinism:
 * - `reducedMotion: 'reduce'` makes every stage jump straight to its
 *   committed end state (see useNameTicker/Wheel's `reduced` branch) instead
 *   of animating — no sleeps needed, only Playwright's built-in waiting.
 * - The draw's outcome is pinned by seeding the session event log (the
 *   localStorage-backed store `createSessionApi` uses in static/PWA mode)
 *   with a team and an already-committed spin (fixed serverSeed), then
 *   pinning the client seed sessionStorage reads. The test still triggers a
 *   real reveal through the UI — commit/reveal itself is never bypassed,
 *   only the two seeds are fixed so it always resolves the same way.
 *
 * Portability: baselines are generated wherever this suite first runs with
 * --update-snapshots. Font rendering differs between macOS (local) and
 * Linux (CI) — see the test-writing report for the recommended CI setup.
 */

test.use({ viewport: { width: 1280, height: 900 } });

const VISUALIZATIONS: Vis[] = ['wheel', 'train', 'board', 'signal', 'stamp', 'timetable', 'line'];
const THEMES = ['light', 'dark'] as const;

for (const vis of VISUALIZATIONS) {
  for (const theme of THEMES) {
    test(`${vis} visualization renders the committed result (${theme})`, async ({ page }) => {
      const session = await buildSessionEvents();
      await page.addInitScript(
        ([sessionEvents, animSettings, themeValue, spinId, clientSeed]) => {
          localStorage.setItem('schuldrad.sessionEvents.v1', sessionEvents);
          localStorage.setItem('schuldrad.anim', animSettings);
          localStorage.setItem('schuldrad.theme', themeValue);
          sessionStorage.setItem(`schuldrad.clientSeed.${spinId}`, clientSeed);
        },
        [JSON.stringify(session), JSON.stringify({ vis }), theme, SPIN_ID, CLIENT_SEED] as const,
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });

      await page.goto(`/wheeloffault/#/team/${TEAM_ID}`);
      await page.getByTestId('spin-button').click();

      const resultName = page.getByTestId('result-name');
      await expect(resultName).toBeVisible();
      await expect(resultName.locator('.visually-hidden')).toHaveText(EXPECTED_WINNER);

      const stage = page.getByTestId('visualization-stage');
      await expect(stage).toHaveScreenshot(`${vis}-${theme}.png`, { animations: 'disabled' });
    });
  }
}
