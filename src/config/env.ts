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
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12, 'Use at least 12 characters').max(128).optional(),
  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().min(1).default('smtp.gmail.com'),
  SMTP_PORT: integer(1, 65535, 465),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
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
  ADMIN_EMAIL?: string | undefined;
  ADMIN_PASSWORD?: string | undefined;
  MAIL_DRIVER: 'console' | 'smtp';
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string | undefined;
  SMTP_PASS?: string | undefined;
  MAIL_FROM?: string | undefined;
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
  const production = (nodeEnv ?? 'production') === 'production';
  if (production && cleaned.MAIL_DRIVER !== 'smtp') {
    problems.push('MAIL_DRIVER: Must be smtp in production');
  }
  if (cleaned.MAIL_DRIVER === 'smtp') {
    for (const name of ['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const) {
      if (cleaned[name] === undefined) problems.push(`${name}: Required when MAIL_DRIVER is smtp`);
    }
  }
  if ((cleaned.ADMIN_EMAIL === undefined) !== (cleaned.ADMIN_PASSWORD === undefined)) {
    problems.push('ADMIN_EMAIL and ADMIN_PASSWORD: Set both or neither');
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
