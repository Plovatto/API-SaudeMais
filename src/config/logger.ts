import { pino, type LoggerOptions } from 'pino';
import { env } from './env.js';

// Headers and fields that may carry credentials or personal data. Request bodies are never logged.
export const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
];

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: redactedPaths, censor: '[redacted]' },
};

if (env.NODE_ENV === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  };
}

export const logger = pino(options);
