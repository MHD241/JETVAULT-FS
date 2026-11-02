import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(sha + ' ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
