import { Writable } from 'node:stream';
import { createLogger } from '@/config/create-logger.js';

export function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination), lines };
}
