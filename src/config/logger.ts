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
  'pass',
  '*.pass',
  'SMTP_PASS',
  '*.SMTP_PASS',
  'err.params',
  'err.query',
];

interface QueryError extends Error {
  query: unknown;
  params: unknown;
}

function isQueryError(error: unknown): error is QueryError {
  return error instanceof Error && 'query' in error && 'params' in error;
}

function findQueryError(error: unknown): QueryError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (isQueryError(current)) return current;
    current = current.cause;
  }
  return undefined;
}

export function serializeError(error: unknown) {
  const queryError = findQueryError(error);
  if (!queryError) return pino.stdSerializers.err(error as Error);
  const cause = queryError.cause as { code?: unknown; constraint?: unknown } | undefined;
  return { type: queryError.name, message: 'Database query failed', code: cause?.code, constraint: cause?.constraint };
}

export function buildLoggerOptions(config: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): LoggerOptions {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: { paths: redactedPaths, censor: '[redacted]' },
    serializers: { err: serializeError },
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
