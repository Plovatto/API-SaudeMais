import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` is used: migrations are plain SQL files applied by the API at startup.
// `drizzle-kit push` is never used, because it would bypass the hand-written migrations
// (extensions, exclusion constraints, partial indexes).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
