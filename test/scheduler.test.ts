import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/config/logger.js';
import { startScheduler } from '@/jobs/scheduler.js';

const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduler', () => {
  it('runs at once and on every interval, never overlapping a run still in progress', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));

    const scheduler = startScheduler(task, 1000, logger);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    const stopped = scheduler.stop();
    finish();
    await stopped;
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('keeps running after a failed run', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);

    const scheduler = startScheduler(task, 1000, logger);
    await vi.advanceTimersByTimeAsync(1000);

    expect(task).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });
});
