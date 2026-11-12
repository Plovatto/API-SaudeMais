import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    CORS_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
  })
  .transform((value, ctx) => {
    if (value.CORS_ORIGIN === undefined && value.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN'], message: 'Required in production' });
      return z.NEVER;
    }
    return { ...value, CORS_ORIGIN: new URL(value.CORS_ORIGIN ?? 'http://localhost:5173').origin };
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    // Only variable names and rules are reported, never the values, so secrets do not reach the logs.
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment variables\n- ${problems.join('\n- ')}`);
  }

  return parsed.data;
}

export const env = parseEnv(process.env);
