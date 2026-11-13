import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env.js';

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Thrown value is not an Error', { cause: error });
  }
  throw new Error('Expected the function to throw');
}

const DB = 'postgres://user:pass@localhost:5432/saudemais';
const dev = { NODE_ENV: 'development', DATABASE_URL: DB };

describe('parseEnv', () => {
  it('applies defaults for local development', () => {
    expect(parseEnv(dev)).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: DB,
      SESSION_TTL_HOURS: 12,
      SESSION_REMEMBER_DAYS: 7,
    });
  });

  it('requires TRUST_PROXY_HOPS in production, so rate limits never see only the proxy address', () => {
    const error = captureError(() =>
      parseEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'https://plovatto.github.io', DATABASE_URL: DB }),
    );

    expect(error.message).toContain('TRUST_PROXY_HOPS: Required in production');
  });

  it('requires ADMIN_EMAIL and ADMIN_PASSWORD together', () => {
    expect(captureError(() => parseEnv({ ...dev, ADMIN_EMAIL: 'admin@saudemais.test' })).message).toContain(
      'ADMIN_EMAIL and ADMIN_PASSWORD: Set both or neither',
    );
  });

  it('defaults to production, which requires CORS_ORIGIN', () => {
    expect(captureError(() => parseEnv({ DATABASE_URL: DB })).message).toContain('CORS_ORIGIN: Required in production');
  });

  it('accepts a complete production configuration', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      TRUST_PROXY_HOPS: '1',
      CORS_ORIGIN: 'https://plovatto.github.io',
      DATABASE_URL: DB,
    });

    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 1,
      CORS_ORIGIN: 'https://plovatto.github.io',
      DATABASE_URL: DB,
      SESSION_TTL_HOURS: 12,
      SESSION_REMEMBER_DAYS: 7,
    });
  });

  it('normalizes CORS_ORIGIN to an origin, dropping path and credentials', () => {
    const env = parseEnv({ ...dev, CORS_ORIGIN: 'https://user:pass@plovatto.github.io/SaudeMais/' });

    expect(env.CORS_ORIGIN).toBe('https://plovatto.github.io');
  });

  it('treats empty values as unset', () => {
    const env = parseEnv({ ...dev, PORT: '', LOG_LEVEL: '', TRUST_PROXY_HOPS: '', CORS_ORIGIN: '' });

    expect(env).toMatchObject({
      PORT: 3001,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGIN: 'http://localhost:5173',
    });
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', 'abc'],
    ['PORT', '0x50'],
    ['PORT', '80.5'],
    ['TRUST_PROXY_HOPS', '-1'],
    ['TRUST_PROXY_HOPS', '6'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['CORS_ORIGIN', 'javascript:alert(1)'],
    ['CORS_ORIGIN', 'ftp://files.example'],
    ['CORS_ORIGIN', 'https://a.github.io,https://b.github.io'],
    ['DATABASE_URL', 'mysql://user:pass@localhost/db'],
    ['DATABASE_URL', 'not-a-url'],
  ])('rejects %s=%s', (name, value) => {
    const error = captureError(() => parseEnv({ ...dev, [name]: value }));

    expect(error.message).toContain(`${name}:`);
  });

  it('requires DATABASE_URL in every environment', () => {
    const error = captureError(() => parseEnv({ NODE_ENV: 'development' }));

    expect(error.message).toContain('DATABASE_URL:');
  });

  it('accepts both postgres and postgresql schemes', () => {
    expect(parseEnv({ ...dev, DATABASE_URL: 'postgresql://u:p@h/db?sslmode=require' }).DATABASE_URL).toBe(
      'postgresql://u:p@h/db?sslmode=require',
    );
  });

  it('reports every problem at once', () => {
    const error = captureError(() => parseEnv({ NODE_ENV: 'production', PORT: 'abc', DATABASE_URL: DB }));

    expect(error.message).toContain('PORT:');
    expect(error.message).toContain('CORS_ORIGIN: Required in production');
  });

  it.each([
    ['PORT', 'secret-value-123'],
    ['NODE_ENV', 'secret-value-123'],
    ['LOG_LEVEL', 'secret-value-123'],
    ['TRUST_PROXY_HOPS', 'secret-value-123'],
    ['CORS_ORIGIN', 'ftp://user:secret-value-123@host'],
    ['DATABASE_URL', 'mysql://user:secret-value-123@host/db'],
  ])('never echoes the value of %s', (name, value) => {
    const error = captureError(() => parseEnv({ ...dev, [name]: value }));

    expect(error.message).toContain(name);
    expect(error.message).not.toContain('secret-value-123');
  });
});
