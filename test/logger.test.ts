import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildLoggerOptions, createLogger } from '@/config/logger.js';

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination), lines };
}

describe('logger redaction', () => {
  it('keeps query text, parameters and stack out of database error logs', () => {
    const { logger, lines } = captureLogger();
    const cause = Object.assign(new Error('violates check constraint "users_phone_check"'), {
      code: '23514',
      constraint: 'users_phone_check',
    });
    const error = Object.assign(new Error('Failed query: insert into users\nparams: ana@email.com,scrypt$SECRETHASH'), {
      name: 'DrizzleQueryError',
      query: 'insert into users',
      params: ['ana@email.com', 'scrypt$SECRETHASH'],
      cause,
    });

    logger.error({ err: new Error('Registration failed', { cause: error }) }, 'Unhandled error');

    const output = lines.join('');
    expect(output).not.toContain('ana@email.com');
    expect(output).not.toContain('SECRETHASH');
    expect(JSON.parse(output)).toMatchObject({
      err: { type: 'DrizzleQueryError', code: '23514', constraint: 'users_phone_check' },
    });
  });

  it('hides credential headers', () => {
    const { logger, lines } = captureLogger();

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer AUTHSECRET',
          'proxy-authorization': 'Basic PROXYSECRET',
          cookie: 'sid=COOKIESECRET',
          'x-api-key': 'APIKEYSECRET',
        },
      },
      res: { headers: { 'set-cookie': 'sid=SETCOOKIESECRET' } },
    });

    const entry = JSON.parse(lines[0] ?? '{}') as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(entry.req.headers).toEqual({
      authorization: '[redacted]',
      'proxy-authorization': '[redacted]',
      cookie: '[redacted]',
      'x-api-key': '[redacted]',
    });
    expect(entry.res.headers).toEqual({ 'set-cookie': '[redacted]' });
  });

  it('hides passwords and tokens at the top level and one level down', () => {
    const { logger, lines } = captureLogger();

    logger.info({ password: 'P1', token: 'T1', user: { password: 'P2', token: 'T2' } });

    const output = lines.join('');
    for (const secret of ['P1', 'T1', 'P2', 'T2']) {
      expect(output).not.toContain(`"${secret}"`);
    }
  });

  it('hides the raw request body attached to parse errors', () => {
    const { logger, lines } = captureLogger();

    logger.error({ err: { message: 'bad json', body: '{"password":"BODYSECRET"' } });

    expect(lines.join('')).not.toContain('BODYSECRET');
  });
});

describe('buildLoggerOptions', () => {
  it('uses pretty output only in development', () => {
    expect(buildLoggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'info' }).transport).toBeDefined();
    expect(buildLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).transport).toBeUndefined();
    expect(buildLoggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'info' }).transport).toBeUndefined();
  });
});
