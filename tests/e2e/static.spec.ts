import { expect, test } from '@playwright/test';

test('project-site PWA keeps its session after an offline reload', async ({ page, context }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/api/')) apiRequests.push(request.url());
  });
  await page.goto('/wheeloffault/');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe('http://127.0.0.1:3101/wheeloffault/');
  await page.reload();
  await page.getByTestId('create-team-input').fill('Offline team');
  await page.getByTestId('create-team-button').click();
  await expect(page.getByRole('heading', { name: 'Offline team', exact: true })).toBeVisible();
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (!url) throw new Error('manifest missing');
    const data = await fetch(url).then((response) => response.json());
    return {
      start: new URL(data.start_url, url).pathname,
      icon: new URL(data.icons[0].src, url).pathname,
    };
  });
  expect(manifest).toEqual({ start: '/wheeloffault/', icon: '/wheeloffault/icon.svg' });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const assets = [
          ...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
            'script[src], link[rel="stylesheet"]',
          ),
        ].map((element) => (element instanceof HTMLScriptElement ? element.src : element.href));
        // Preview adds Vary: Origin to module responses. This checks presence;
        // the offline reload below exercises the browser's real request headers.
        return (
          await Promise.all(assets.map((url) => caches.match(url, { ignoreVary: true })))
        ).every(Boolean);
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Offline team', exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});
