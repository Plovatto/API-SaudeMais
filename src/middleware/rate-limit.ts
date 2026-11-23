import { rateLimit, type Options } from 'express-rate-limit';
import { AppError } from '../lib/app-error.js';
import { MINUTE } from '../lib/time.js';

export const TOO_MANY_REQUESTS_MESSAGE = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

export const rateLimitDefaults: Partial<Options> = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 503,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'TOO_MANY_REQUESTS', TOO_MANY_REQUESTS_MESSAGE));
  },
};

export function limitRequests(limit: number, windowMs = MINUTE, options: Partial<Options> = {}) {
  return rateLimit({ ...rateLimitDefaults, windowMs, limit, ...options });
}
