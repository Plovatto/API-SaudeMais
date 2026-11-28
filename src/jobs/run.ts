import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { createDb, createPool } from '../database/pg-client.js';
import { createMailer, MailQueue } from '../mail/index.js';
import { createModulesFromEnv } from '../modules/index.js';

const [job] = process.argv.slice(2);
if (job !== 'maintenance') {
  logger.fatal({ job }, 'Unknown job; available: maintenance');
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);

try {
  const { maintenance } = createModulesFromEnv(env, createDb(pool), new MailQueue(createMailer(env, logger), logger));
  await maintenance.runExclusive();
} catch (err) {
  logger.fatal({ err }, 'Maintenance failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
