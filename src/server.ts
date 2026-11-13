import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { runMigrations } from './database/migrate.js';
import { createPool } from './database/pg-client.js';
import { createShutdown } from './lib/graceful-shutdown.js';

const SHUTDOWN_DEADLINE_MS = 20_000;

const pool = createPool(env.DATABASE_URL);
const shutdown = createShutdown({ pool, timeoutMs: 8_000 });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`);
    setTimeout(() => {
      logger.fatal('Shutdown deadline exceeded');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    shutdown
      .run()
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error({ err }, 'Shutdown failed');
        process.exit(1);
      });
  });
}

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
  process.exit(1);
});

try {
  await runMigrations(pool);
  logger.info('Database migrations applied');
} catch (err) {
  logger.fatal({ err }, 'Database migrations failed');
  await pool.end();
  process.exit(1);
}

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
  logger.info(`Environment: ${env.NODE_ENV}`);
  logger.info(`CORS origin: ${env.CORS_ORIGIN}`);
});
shutdown.attach(server);

server.on('error', (err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
