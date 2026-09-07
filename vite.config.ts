import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: './',
  publicDir: 'public',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  // Trailing slash so the proxy never swallows the /api.ts module in dev.
  server: { proxy: { '/api/': 'http://localhost:3000' } },
});
