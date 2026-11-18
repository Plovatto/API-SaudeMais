import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { runMigrations } from './database/migrate.js';
import { createDb, createPool } from './database/pg-client.js';
import { createMailer, MailQueue } from './mail/index.js';
import { MAINTENANCE_SCHEDULE, startScheduler } from './jobs/scheduler.js';
import { createShutdown } from './lib/graceful-shutdown.js';
import { systemClock } from './lib/clock.js';
import { createModulesFromEnv } from './modules/index.js';

const SHUTDOWN_DEADLINE_MS = 20_000;

const pool = createPool(env.DATABASE_URL);
let lastDbActivityAt = 0;
pool.on('acquire', () => {
  lastDbActivityAt = systemClock.now().getTime();
});

const mail = new MailQueue(createMailer(env, logger), logger);
let scheduler: ReturnType<typeof startScheduler> | undefined;
const shutdown = createShutdown({
  pool,
  flush: async () => {
    await scheduler?.settled();
    await mail.drain();
  },
  timeoutMs: 8_000,
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`);
    scheduler?.stop();
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

const { users, maintenance, routers } = createModulesFromEnv(env, createDb(pool), mail);

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

if (env.MAINTENANCE_SCHEDULER) {
  scheduler = startScheduler(() => maintenance.runExclusive(), {
    schedule: MAINTENANCE_SCHEDULE,
    clock: systemClock,
    lastActivityAt: () => lastDbActivityAt,
    logger,
  });
}

server.on('error', (err) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
