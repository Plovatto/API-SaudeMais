import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool, poolOptions } from '@/database/pg-client.js';
import { logger } from '@/config/logger.js';

describe('poolOptions', () => {
  it('keeps the pool small and every wait bounded', () => {
    expect(poolOptions('postgres://user:pass@host/db')).toEqual({
      connectionString: 'postgres://user:pass@host/db',
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'api-saudemais',
    });
  });
});

describe('createPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs idle client errors instead of crashing the process', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const pool = createPool('postgres://user:pass@127.0.0.1:1/db');

    pool.emit('error', new Error('terminating connection due to administrator command'), undefined);

    expect(spy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: 'terminating connection due to administrator command' }) as unknown },
      'Idle database client error',
    );
    await pool.end();
  });
});
