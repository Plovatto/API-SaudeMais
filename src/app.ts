import './lib/zod-locale.js';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { env, type Env } from './config/env.js';
import { logger as defaultLogger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export type AppConfig = Pick<Env, 'CORS_ORIGIN' | 'TRUST_PROXY_HOPS'>;

export interface AppOptions {
  config?: AppConfig;
  logger?: Logger;
}

function pathOf(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

export function createApp({ config = env, logger = defaultLogger }: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  // First, so every request is logged, including CORS preflights and body-parser errors.
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => pathOf(req.url) === '/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Only what is needed to trace a request: no headers, query string, params or body,
      // since they may carry tokens or personal data (LGPD).
      serializers: {
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string; raw?: { ip?: string } }) => ({
          id: req.id,
          method: req.method,
          path: pathOf(req.url),
          // Client IP honoring `trust proxy`, so it is not the proxy address behind Northflank.
          ip: req.raw?.ip ?? req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  // The front sends the session as a Bearer token, never as a cookie, so credentials stay off.
  app.use(cors({ origin: config.CORS_ORIGIN, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));

  // Does not touch the database, so health checks never wake it up.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
