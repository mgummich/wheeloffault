import { defineConfig } from '@playwright/test';

/** Runs against the production build so the E2E journey covers the real server + static files. */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'node src/server/main.ts',
    url: 'http://127.0.0.1:3100/api/health',
    env: { PORT: '3100', DATA_DIR: 'test-results/e2e-data' },
    reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
