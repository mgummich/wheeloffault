import { expect, test } from '@playwright/test';

test('server teams and live changes are shared between browsers', async ({
  page,
  browser,
  request,
}) => {
  const response = await request.post('/api/teams', { data: { name: 'Shared team' } });
  const team = await response.json();
  const other = await browser.newPage();
  try {
    const url = `/#/team/${team.teamId}/teilnehmer`;
    await page.goto(url);
    await other.goto(new URL(url, page.url()).href);
    await expect(other.getByRole('heading', { name: 'Aktiv (0)' })).toBeVisible();
    await page.getByTestId('add-member-input').fill('Shared member');
    await page.getByTestId('add-member-button').click();
    await expect(other.getByTestId('member-row')).toContainText('Shared member');
    await other.reload();
    await expect(other.getByTestId('member-row')).toContainText('Shared member');
  } finally {
    await other.close();
  }
});

/**
 * The one critical journey: team → participants → deactivate → spin →
 * commit → reveal → result → Schuldbericht → statistics → reload → history.
 */
test('Schuldrad journey', async ({ page }) => {
  await page.goto('/#/');
  await page.getByTestId('create-team-input').fill('Team Fahrplan');
  await page.getByTestId('create-team-button').click();
  await expect(page).toHaveURL(/#\/team\/[A-Za-z0-9_-]+/);
  const teamUrl = page.url();

  await page.goto(`${teamUrl.replace(/\/?$/, '')}/teilnehmer`);
  await page.getByTestId('add-member-input').fill('Anna');
  await page.getByTestId('add-member-button').click();
  await expect(page.getByTestId('member-row')).toHaveCount(1);
  await page.getByTestId('paste-list-textarea').fill('Bob\nCem\nDana');
  await page.getByTestId('paste-list-button').click();
  await expect(page.getByTestId('member-row')).toHaveCount(4);

  // Deactivate Bob; he must not be selectable afterwards.
  const bobRow = page.getByTestId('member-row').filter({ hasText: 'Bob' });
  await bobRow.getByTestId('deactivate-button').click();
  await expect(bobRow.getByTestId('reactivate-button')).toBeVisible();

  await page.goto(teamUrl);
  await page.getByTestId('spin-button').click();
  await page.getByTestId('skip-animation').click();
  const resultName = page.getByTestId('result-name');
  await expect(resultName).toBeVisible();
  const winner = (await resultName.locator('.visually-hidden').textContent())?.trim() ?? '';
  expect(['Anna', 'Cem', 'Dana']).toContain(winner);
  // The announced name must be the persisted result, not something the animation picked.
  const teamId = teamUrl.split('/team/')[1]?.replace(/\/.*$/, '') ?? '';
  const persisted = await page.evaluate(async (id) => {
    const t = await fetch(`/api/teams/${id}`).then((r) => r.json());
    return t.members.find(
      (m: { memberId: string }) => m.memberId === t.spins[0].reveal.selectedMemberId,
    ).name;
  }, teamId);
  expect(winner).toBe(persisted);

  await page.getByTestId('open-report').click();
  await expect(page).toHaveURL(/bericht/);
  await expect(page.getByTestId('report-total-selections')).toHaveText(/1/);

  await page.goto(`${teamUrl.replace(/\/?$/, '')}/statistik`);
  await expect(page.getByTestId('hall-row').first()).toContainText(winner);
  await expect(page.getByTestId('history-row')).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId('history-row')).toHaveCount(1);
  await expect(page.getByTestId('history-row').first()).toContainText(winner);

  // Verifier reproduces the server's draw in the browser.
  await page.getByTestId('history-row').first().getByRole('link').first().click();
  await page.getByTestId('verify-button').click();
  await expect(page.getByTestId('verify-result')).toContainText('Ziehung gültig');
});
