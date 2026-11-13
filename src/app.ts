import './lib/zod-locale.js';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { env, type Env } from './config/env.js';
import { logger as defaultLogger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createDocsRouter } from './routes/docs.js';
import { createHealthRouter } from './routes/health.js';

export type AppConfig = Pick<Env, 'NODE_ENV' | 'CORS_ORIGIN' | 'TRUST_PROXY_HOPS'>;

export interface AppOptions {
  config?: AppConfig;
  logger?: Logger;
}

function pathOf(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

function isQuietPath(path: string): boolean {
  return path === '/health' || (path.startsWith('/docs') && path !== '/docs/openapi.json');
}

export function createApp({ config = env, logger = defaultLogger }: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => isQuietPath(pathOf(req.url)) },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // LGPD: headers, query string and body may carry tokens or personal data and must never be logged.
      serializers: {
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string; raw?: { ip?: string } }) => ({
          id: req.id,
          method: req.method,
          path: pathOf(req.url),
          ip: req.raw?.ip ?? req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null },
      },
    }),
  );
  app.use(cors({ origin: config.CORS_ORIGIN, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));

  app.use(createHealthRouter());
  app.use(createDocsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
