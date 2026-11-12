import { describe, expect, it } from 'vitest';
import { assertDisposableDatabase } from '../test-pg/support/pg-test-pool.js';

describe('assertDisposableDatabase', () => {
  it.each([
    'postgres://postgres:postgres@localhost:5432/saudemais_test',
    'postgresql://user:pass@127.0.0.1/any_name_test?sslmode=disable',
  ])('accepts %s', (url) => {
    expect(() => assertDisposableDatabase(url)).not.toThrow();
  });

  it.each([
    'postgres://user:secret-value-123@ep-cool.sa-east-1.aws.neon.tech/saudemais',
    'postgres://user:secret-value-123@localhost:5432/saudemais',
    'postgres://user:secret-value-123@localhost:5432/test_saudemais',
    'postgres://user:secret-value-123@localhost:5432/',
  ])('refuses a database whose name does not end with _test', (url) => {
    expect(() => assertDisposableDatabase(url)).toThrow(/_test/);
  });

  it('never echoes the connection string', () => {
    let message = '';
    try {
      assertDisposableDatabase('postgres://user:secret-value-123@localhost:5432/saudemais');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).not.toBe('');
    expect(message).not.toContain('secret-value-123');
  });
});
