import { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { MINUTE } from '../../lib/time.js';
import { createRateLimit } from '../../middleware/rate-limit.js';
import { normalizeEmail } from './user.model.js';

function emailOf(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? normalizeEmail(email).slice(0, 254) : '';
}

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '');

export function createUserRateLimits() {
  return {
    register: createRateLimit({ windowMs: 60 * MINUTE, limit: 10 }),
    loginByIp: createRateLimit({ windowMs: 15 * MINUTE, limit: 30 }),
    loginByEmailAndIp: createRateLimit({
      windowMs: 15 * MINUTE,
      limit: 5,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${emailOf(req)}|${ipOf(req)}`,
    }),
    loginByEmail: createRateLimit({
      windowMs: 60 * MINUTE,
      limit: 50,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => emailOf(req) || `ip:${ipOf(req)}`,
    }),
  };
}

export type UserRateLimits = ReturnType<typeof createUserRateLimits>;
