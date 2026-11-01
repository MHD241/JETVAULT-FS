import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input: { main: 'index.html', studio: 'studio.html' } } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
