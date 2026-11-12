import 'dotenv/config';
import '../lib/zod-locale.js';
import { z } from 'zod';

function integer(min: number, max: number, fallback: number) {
  // Decimal digits only: rejects values such as "0x50" or "1e3" that z.coerce.number() would accept.
  return z
    .string()
    .regex(/^\d+$/, 'Expected a whole number')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(fallback);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: integer(1, 65535, 3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY_HOPS: integer(0, 5, 0),
  CORS_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => !value.includes(','), 'Only one origin is allowed')
    .optional(),
});

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  TRUST_PROXY_HOPS: number;
  CORS_ORIGIN: string;
}

const DEV_CORS_ORIGIN = 'http://localhost:5173';

export function parseEnv(source: Record<string, string | undefined>): Env {
  // An empty value (`PORT=`) means "not set", so the default applies instead of failing.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(cleaned);

  // Only variable names and rules are reported, never the values, so secrets do not reach the logs.
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  const nodeEnv = parsed.success ? parsed.data.NODE_ENV : cleaned.NODE_ENV;
  if ((nodeEnv ?? 'production') === 'production' && cleaned.CORS_ORIGIN === undefined) {
    problems.push('CORS_ORIGIN: Required in production');
  }

  if (!parsed.success || problems.length > 0) {
    throw new Error(`Invalid environment variables\n- ${problems.join('\n- ')}`);
  }

  return { ...parsed.data, CORS_ORIGIN: new URL(parsed.data.CORS_ORIGIN ?? DEV_CORS_ORIGIN).origin };
}

export const env = parseEnv(process.env);
