import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(helmet());
  // The front sends the session as a Bearer token, never as a cookie, so credentials stay off.
  app.use(cors({ origin: env.CORS_ORIGIN, maxAge: 600 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // Does not touch the database, so health checks never wake it up.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
