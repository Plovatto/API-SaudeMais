import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ConsoleMailer } from '../mail/console-mailer.js';
import { MailQueue } from '../mail/index.js';
import { createModulesFromEnv } from '../modules/index.js';
import { seedTarget } from '../modules/seed/seed-guard.js';
import { runMigrations } from './migrate.js';
import { createDb, createPool } from './pg-client.js';

let host: string;
try {
  host = seedTarget(env.NODE_ENV, env.DATABASE_URL, process.env.SEED_ALLOW_PRODUCTION, process.env.SEED_ALLOW_REMOTE);
} catch (err) {
  logger.fatal({ err }, 'Seeding refused');
  process.exit(1);
}
logger.info({ host }, 'Seeding sample data');

const pool = createPool(env.DATABASE_URL);

try {
  await runMigrations(pool);
  const { seed } = createModulesFromEnv(env, createDb(pool), new MailQueue(new ConsoleMailer(logger), logger));
  for (const warning of await seed.service.seed()) logger.warn(warning);
  if (env.EXAMPLE_ACCOUNT_RESET) {
    for (const warning of await seed.service.seedMultiProfile()) logger.warn(warning);
  }
  logger.info('Sample data ensured');
} catch (err) {
  logger.fatal({ err }, 'Seeding failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
