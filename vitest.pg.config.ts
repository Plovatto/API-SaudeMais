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
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      LOG_LEVEL: 'silent',
      TRUST_PROXY_HOPS: '0',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/saudemais_test',
    },
    include: ['test-pg/**/*.test.ts'],
    fileParallelism: false,
  },
});
