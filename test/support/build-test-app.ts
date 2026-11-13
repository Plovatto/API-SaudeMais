import { Writable } from 'node:stream';
import { createApp, type AppConfig } from '@/app.js';
import { createLogger } from '@/config/logger.js';

export const TEST_CORS_ORIGIN = 'http://localhost:5173';

export function buildTestApp(overrides: Partial<AppConfig> = {}) {
  const logLines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      logLines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination);
  const config: AppConfig = { NODE_ENV: 'test', CORS_ORIGIN: TEST_CORS_ORIGIN, TRUST_PROXY_HOPS: 0, ...overrides };
  const app = createApp({ config, logger });

  return { app, logLines };
}
