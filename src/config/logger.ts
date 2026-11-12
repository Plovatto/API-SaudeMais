import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { env, type Env } from './env.js';

export const redactedPaths = [
  'req.headers.authorization',
  'req.headers["proxy-authorization"]',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'token',
  '*.password',
  '*.token',
  'err.body',
];

export function buildLoggerOptions(config: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): LoggerOptions {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: { paths: redactedPaths, censor: '[redacted]' },
  };

  if (config.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    };
  }

  return options;
}

export function createLogger(config: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  const options = buildLoggerOptions(config);
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger(env);
