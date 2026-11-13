import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { runMigrations } from './database/migrate.js';
import { createDb, createPool } from './database/pg-client.js';
import { systemClock } from './lib/clock.js';
import { createMailer, MailQueue } from './mail/index.js';
import { createShutdown } from './lib/graceful-shutdown.js';
import { createModules } from './modules/index.js';

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

const mail = new MailQueue(await createMailer(env, logger), logger);

const { users, routers } = createModules({
  mail,
  db: createDb(pool),
  clock: systemClock,
  policy: {
    idleHours: env.SESSION_TTL_HOURS,
    maxDays: env.SESSION_REMEMBER_DAYS,
    maxSessionsPerUser: 10,
  },
});

try {
  await runMigrations(pool);
  logger.info('Database migrations applied');
  const admin =
    env.ADMIN_EMAIL && env.ADMIN_PASSWORD ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } : undefined;
  await users.bootstrap(admin);
  logger.info('Initial accounts ensured');
} catch (err) {
  logger.fatal({ err }, 'Database setup failed');
  await pool.end();
  process.exit(1);
}

const app = createApp({ routers });

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
