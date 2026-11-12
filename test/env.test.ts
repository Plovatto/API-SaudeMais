import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env.js';

describe('parseEnv', () => {
  it('applies defaults for local development', () => {
    const env = parseEnv({});

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      TRUST_PROXY_HOPS: 0,
      CORS_ORIGIN: 'http://localhost:5173',
    });
  });

  it('coerces numeric variables', () => {
    const env = parseEnv({ PORT: '8080', TRUST_PROXY_HOPS: '1' });

    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it('normalizes CORS_ORIGIN to an origin, dropping any path', () => {
    const env = parseEnv({ CORS_ORIGIN: 'https://plovatto.github.io/SaudeMais/' });

    expect(env.CORS_ORIGIN).toBe('https://plovatto.github.io');
  });

  it('requires CORS_ORIGIN in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN/);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects a CORS_ORIGIN that is not http or https', () => {
    expect(() => parseEnv({ CORS_ORIGIN: 'javascript:alert(1)' })).toThrow(/CORS_ORIGIN/);
  });

  it('never echoes variable values in the error', () => {
    expect(() => parseEnv({ PORT: 'secret-value-123' })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('secret-value-123') as unknown }) as Error,
    );
  });
});
