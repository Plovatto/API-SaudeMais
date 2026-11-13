import { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { createRateLimit } from '../../middleware/rate-limit.js';

const MINUTE = 60_000;

function emailKey(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createUserRateLimits() {
  return {
    register: createRateLimit({ windowMs: 60 * MINUTE, limit: 10 }),
    loginByIp: createRateLimit({ windowMs: 15 * MINUTE, limit: 30 }),
    loginByEmail: createRateLimit({
      windowMs: 15 * MINUTE,
      limit: 5,
      skipSuccessfulRequests: true,
      keyGenerator: emailKey,
    }),
  };
}

export type UserRateLimits = ReturnType<typeof createUserRateLimits>;
