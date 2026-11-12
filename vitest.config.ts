import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Every variable is pinned so a local .env never changes the test run.
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      LOG_LEVEL: 'silent',
      TRUST_PROXY_HOPS: '0',
      CORS_ORIGIN: 'http://localhost:5173',
      // Never contacted: tests use an in-memory PGlite database.
      DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    },
    // Tests live in test/, not next to the source.
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
      reporter: ['text', 'html'],
    },
  },
});
