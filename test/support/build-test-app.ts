import { Writable } from 'node:stream';
import { createApp, type AppConfig } from '@/app.js';
import { createLogger } from '@/config/logger.js';
import type { Database } from '@/database/pg-client.js';
import { systemClock } from '@/lib/clock.js';
import { MailQueue } from '@/mail/index.js';
import { MemoryMailer } from './memory-mailer.js';
import { createModules, type ModulesDeps } from '@/modules/index.js';

export const TEST_CORS_ORIGIN = 'http://localhost:5173';

const noDatabase = new Proxy(
  {},
  {
    get() {
      throw new Error('This test app has no database; pass one to buildTestApp');
    },
  },
) as Database;

export function buildTestApp(overrides: Partial<AppConfig> = {}, deps: Partial<ModulesDeps> = {}) {
  const logLines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logLines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination);
  const config: AppConfig = {
    NODE_ENV: 'test',
    CORS_ORIGIN: TEST_CORS_ORIGIN,
    TRUST_PROXY_HOPS: 0,
    ...overrides,
  };
  const mailer = new MemoryMailer();
  const mail = new MailQueue(mailer, logger);
  const modules = createModules({
    db: noDatabase,
    mail,
    appUrl: 'https://app.saudemais.test',
    clock: systemClock,
    policy: { idleHours: 12, maxDays: 7, maxSessionsPerUser: 10 },
    ...deps,
  });
  const app = createApp({ config, logger, routers: modules.routers });

  return { app, logLines, modules, mailer, mail };
}
