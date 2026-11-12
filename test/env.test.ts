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

describe('parseEnv', () => {
  it('applies defaults for local development', () => {
    expect(parseEnv({ NODE_ENV: 'development' })).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGIN: 'http://localhost:5173',
    });
  });

  it('defaults to production, which requires CORS_ORIGIN', () => {
    expect(captureError(() => parseEnv({})).message).toContain('CORS_ORIGIN: Required in production');
  });

  it('accepts a complete production configuration', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      TRUST_PROXY_HOPS: '1',
      CORS_ORIGIN: 'https://plovatto.github.io',
    });

    expect(env).toEqual({
      NODE_ENV: 'production',
      PORT: 8080,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 1,
      CORS_ORIGIN: 'https://plovatto.github.io',
    });
  });

  it('normalizes CORS_ORIGIN to an origin, dropping path and credentials', () => {
    const env = parseEnv({ NODE_ENV: 'development', CORS_ORIGIN: 'https://user:pass@plovatto.github.io/SaudeMais/' });

    expect(env.CORS_ORIGIN).toBe('https://plovatto.github.io');
  });

  it('treats empty values as unset', () => {
    const env = parseEnv({ NODE_ENV: 'development', PORT: '', LOG_LEVEL: '', TRUST_PROXY_HOPS: '', CORS_ORIGIN: '' });

    expect(env).toMatchObject({ PORT: 3001, LOG_LEVEL: 'info', TRUST_PROXY_HOPS: 0, CORS_ORIGIN: 'http://localhost:5173' });
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
  ])('rejects %s=%s', (name, value) => {
    const error = captureError(() => parseEnv({ NODE_ENV: 'development', [name]: value }));

    expect(error.message).toContain(`${name}:`);
  });

  it('reports every problem at once', () => {
    const error = captureError(() => parseEnv({ NODE_ENV: 'production', PORT: 'abc' }));

    expect(error.message).toContain('PORT:');
    expect(error.message).toContain('CORS_ORIGIN: Required in production');
  });

  it.each([
    ['PORT', 'secret-value-123'],
    ['NODE_ENV', 'secret-value-123'],
    ['LOG_LEVEL', 'secret-value-123'],
    ['TRUST_PROXY_HOPS', 'secret-value-123'],
    ['CORS_ORIGIN', 'ftp://user:secret-value-123@host'],
  ])('never echoes the value of %s', (name, value) => {
    const error = captureError(() => parseEnv({ NODE_ENV: 'development', [name]: value }));

    expect(error.message).toContain(name);
    expect(error.message).not.toContain('secret-value-123');
  });
});
