import { describe, expect, it, vi } from 'vitest';
import { retryOnDeadlock } from '@/lib/pg-errors.js';

const deadlock = Object.assign(new Error('Failed query'), { cause: { code: '40P01' } });

describe('retryOnDeadlock', () => {
  it('runs the work again once after a deadlock', async () => {
    const work = vi.fn().mockRejectedValueOnce(deadlock).mockResolvedValueOnce('ok');

    await expect(retryOnDeadlock(work)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('gives up after the second deadlock and never retries other errors', async () => {
    const twice = vi.fn().mockRejectedValue(deadlock);
    const other = vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: '23505' }));

    await expect(retryOnDeadlock(twice)).rejects.toBe(deadlock);
    await expect(retryOnDeadlock(other)).rejects.toThrow('unique');
    expect(twice).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
