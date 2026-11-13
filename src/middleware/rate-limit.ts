import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from '../lib/app-error.js';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  skipSuccessfulRequests?: boolean;
}

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 503,
    ...options,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'));
    },
  });
}
