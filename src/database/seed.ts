import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { systemClock } from '../lib/clock.js';
import { ConsoleMailer } from '../mail/console-mailer.js';
import { MailQueue } from '../mail/index.js';
import { createModules } from '../modules/index.js';
import { seedTarget } from '../modules/demo/seed-guard.js';
import { runMigrations } from './migrate.js';
import { createDb, createPool } from './pg-client.js';

let host: string;
try {
  host = seedTarget(env.NODE_ENV, env.DATABASE_URL, process.env.SEED_ALLOW_PRODUCTION);
} catch (err) {
  logger.fatal({ err }, 'Seeding refused');
  process.exit(1);
}
logger.info({ host }, 'Seeding demo data');

const pool = createPool(env.DATABASE_URL);

try {
  await runMigrations(pool);
  const { demo } = createModules({
    db: createDb(pool),
    clock: systemClock,
    mail: new MailQueue(new ConsoleMailer(logger), logger),
    appUrl: env.APP_PUBLIC_URL,
    policy: { idleHours: env.SESSION_TTL_HOURS, maxDays: env.SESSION_REMEMBER_DAYS, maxSessionsPerUser: 10 },
  });
  for (const warning of await demo.service.seed()) logger.warn(warning);
  logger.info('Demo data ensured');
} catch (err) {
  logger.fatal({ err }, 'Seeding failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
