import { defineConfig } from '@playwright/test';

/** Runs against the production build so the E2E journey covers the real server + static files. */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm build:server && node src/server/main.ts',
      url: 'http://127.0.0.1:3100/api/health',
      env: { PORT: '3100', DATA_DIR: 'test-results/e2e-data' },
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm exec vite build --outDir ../../dist/static && pnpm exec vite preview --outDir ../../dist/static --base /wheeloffault/ --host 127.0.0.1 --port 3101',
      url: 'http://127.0.0.1:3101/wheeloffault/',
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: 'server', testMatch: '**/journey.spec.ts', use: { browserName: 'chromium' } },
    {
      name: 'static',
      testMatch: '**/static.spec.ts',
      use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:3101' },
    },
  ],
});
