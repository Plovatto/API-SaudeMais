import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/config/create-logger.js';
import { startScheduler } from '@/jobs/scheduler.js';
import { systemClock } from '@/lib/clock.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const schedule = {
  checkEveryMs: 5 * MINUTE,
  activeWithinMs: 5 * MINUTE,
  minIntervalMs: HOUR,
  maxIntervalMs: 24 * HOUR,
};

let lastActivity = 0;

const start = (task: () => Promise<unknown>) =>
  startScheduler(task, { schedule, clock: systemClock, lastActivityAt: () => lastActivity, logger });

const touch = () => {
  lastActivity = Date.now();
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-20T12:00:00.000Z') });
  lastActivity = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduler', () => {
  it('runs at startup and then only after an hour with recent database activity', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const scheduler = start(task);
    expect(task).toHaveBeenCalledTimes(1);

    touch();
    await vi.advanceTimersByTimeAsync(55 * MINUTE);
    touch();
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3 * HOUR);
    expect(task).toHaveBeenCalledTimes(2);
    touch();
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(task).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('runs at least once a day even when the database stays idle', async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const scheduler = start(task);

    await vi.advanceTimersByTimeAsync(24 * HOUR - 5 * MINUTE);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(task).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('never overlaps a run in progress and lets shutdown wait for it after stopping the timer', async () => {
    let finish: () => void = () => undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const scheduler = start(task);

    await vi.advanceTimersByTimeAsync(25 * HOUR);
    expect(task).toHaveBeenCalledTimes(1);

    scheduler.stop();
    const settled = scheduler.settled();
    finish();
    await settled;
    await vi.advanceTimersByTimeAsync(25 * HOUR);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a failed run', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const scheduler = start(task);

    await vi.advanceTimersByTimeAsync(24 * HOUR);

    expect(task).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
