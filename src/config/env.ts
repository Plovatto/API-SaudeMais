import 'dotenv/config';
import '../lib/zod-locale.js';
import { z } from 'zod';

function integer(min: number, max: number, fallback: number) {
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
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SESSION_TTL_HOURS: integer(1, 72, 12),
  SESSION_REMEMBER_DAYS: integer(1, 30, 7),
});

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  TRUST_PROXY_HOPS: number;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  SESSION_TTL_HOURS: number;
  SESSION_REMEMBER_DAYS: number;
}

const DEV_CORS_ORIGIN = 'http://localhost:5173';

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = envSchema.safeParse(cleaned);

  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

  const nodeEnv = parsed.success ? parsed.data.NODE_ENV : cleaned.NODE_ENV;
  if ((nodeEnv ?? 'production') === 'production' && cleaned.CORS_ORIGIN === undefined) {
    problems.push('CORS_ORIGIN: Required in production');
  }
  if ((nodeEnv ?? 'production') === 'production' && cleaned.TRUST_PROXY_HOPS === undefined) {
    problems.push('TRUST_PROXY_HOPS: Required in production');
  }

  if (!parsed.success || problems.length > 0) {
    throw new Error(`Invalid environment variables\n- ${problems.join('\n- ')}`);
  }

  return {
    ...parsed.data,
    CORS_ORIGIN: new URL(parsed.data.CORS_ORIGIN ?? DEV_CORS_ORIGIN).origin,
  };
}

export const env = parseEnv(process.env);
