import { describe, expect, it } from 'vitest';
import { MINUTE } from '@/lib/time.js';
import { TtlCache } from '@/lib/ttl-cache.js';
import { fixedClock } from './support/fixed-clock.js';

const START = new Date('2026-11-20T12:00:00.000Z');

const cacheOf = (maxEntries = 1000) => {
  const clock = fixedClock(START);
  return { clock, cache: new TtlCache<number>(clock, 10 * MINUTE, maxEntries) };
};

describe('TtlCache', () => {
  it('serves a loaded value until it expires', async () => {
    const { clock, cache } = cacheOf();

    expect(await cache.resolve('key', () => Promise.resolve(1))).toBe(1);
    clock.advance(10 * MINUTE - 1);
    expect(await cache.resolve('key', () => Promise.resolve(2))).toBe(1);
    clock.advance(1);

    expect(await cache.resolve('key', () => Promise.resolve(3))).toBe(3);
  });

  it('does not keep a value loaded before an invalidation', async () => {
    const { cache } = cacheOf();
    let finish: (count: number) => void = () => undefined;
    const stale = cache.resolve('user:admin', () => new Promise<number>((resolve) => (finish = resolve)));

    cache.delete('user:admin');
    finish(1);

    expect(await stale).toBe(1);
    expect(await cache.resolve('user:admin', () => Promise.resolve(2))).toBe(2);
    expect(await cache.resolve('user:admin', () => Promise.resolve(3))).toBe(2);
  });

  it('caches the next load after a failed one', async () => {
    const { cache } = cacheOf();

    await expect(cache.resolve('user:admin', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');

    expect(await cache.resolve('user:admin', () => Promise.resolve(4))).toBe(4);
    expect(await cache.resolve('user:admin', () => Promise.resolve(5))).toBe(4);
  });

  it('does not cache a missing value', async () => {
    const cache = new TtlCache<number>(fixedClock(START), MINUTE, 10);

    expect(await cache.resolve('key', () => Promise.resolve(undefined))).toBeUndefined();

    expect(cache.size).toBe(0);
  });

  it('deletes every entry that matches', async () => {
    const { cache } = cacheOf();
    for (const value of [1, 2, 3]) await cache.resolve(`key-${value}`, () => Promise.resolve(value));

    cache.deleteWhere((value) => value !== 2);

    expect(cache.size).toBe(1);
    expect(await cache.resolve('key-2', () => Promise.resolve(0))).toBe(2);
  });

  it('drops expired entries first once full', async () => {
    const { clock, cache } = cacheOf();
    for (let index = 0; index < 1000; index += 1) await cache.resolve(`old-${index}`, () => Promise.resolve(1));
    clock.advance(10 * MINUTE);

    await cache.resolve('fresh', () => Promise.resolve(1));

    expect(cache.size).toBe(1);
  });

  it('evicts the oldest entry when full of live ones', async () => {
    const { cache } = cacheOf(2);
    for (const value of [1, 2, 3]) await cache.resolve(`key-${value}`, () => Promise.resolve(value));

    expect(cache.size).toBe(2);
    expect(await cache.resolve('key-1', () => Promise.resolve(0))).toBe(0);
    expect(await cache.resolve('key-3', () => Promise.resolve(0))).toBe(3);
  });
});
