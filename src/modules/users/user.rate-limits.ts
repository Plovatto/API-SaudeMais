import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request } from 'express';
import { MINUTE } from '../../lib/time.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { normalizeEmail } from './user.model.js';

function emailOf(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? normalizeEmail(email).slice(0, 254) : '';
}

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '');

export function createUserRateLimits() {
  return {
    register: rateLimit({
      ...rateLimitDefaults,
      windowMs: 60 * MINUTE,
      limit: 10,
    }),
    loginByIp: rateLimit({
      ...rateLimitDefaults,
      windowMs: 15 * MINUTE,
      limit: 30,
    }),
    loginByEmailAndIp: rateLimit({
      ...rateLimitDefaults,
      windowMs: 15 * MINUTE,
      limit: 5,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `${emailOf(req)}|${ipOf(req)}`,
    }),
    session: rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 }),
    loginByEmail: rateLimit({
      ...rateLimitDefaults,
      windowMs: 60 * MINUTE,
      limit: 50,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => emailOf(req) || `ip:${ipOf(req)}`,
    }),
  };
}

export type UserRateLimits = ReturnType<typeof createUserRateLimits>;
