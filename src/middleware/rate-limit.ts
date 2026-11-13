import type { Options } from 'express-rate-limit';
import { AppError } from '../lib/app-error.js';

export const rateLimitDefaults: Partial<Options> = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 503,
  handler: (_req, _res, next) => {
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'));
  },
};
