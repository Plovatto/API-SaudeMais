import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Suite that needs a real PostgreSQL (TEST_DATABASE_URL): locks, concurrency and constraints
// that the in-memory PGlite used by `npm test` cannot reproduce. Run with `npm run test:pg`.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      LOG_LEVEL: 'silent',
      TRUST_PROXY_HOPS: '0',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/saudemais_test',
    },
    include: ['test-pg/**/*.test.ts'],
    // One shared database: files must not run at the same time.
    fileParallelism: false,
  },
});
