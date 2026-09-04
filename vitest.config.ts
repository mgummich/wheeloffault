import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/domain/**/*.test.ts', 'src/web/**/*.test.ts'] } },
      { test: { name: 'integration', include: ['src/server/**/*.test.ts'] } },
    ],
  },
});
