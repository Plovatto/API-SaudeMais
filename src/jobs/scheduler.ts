import type { Logger } from 'pino';
import type { Clock } from '../lib/clock.js';
import { DAY, HOUR, MINUTE } from '../lib/time.js';

export interface Schedule {
  checkEveryMs: number;
  activeWithinMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
}

export const MAINTENANCE_SCHEDULE: Schedule = {
  checkEveryMs: 5 * MINUTE,
  activeWithinMs: 5 * MINUTE,
  minIntervalMs: HOUR,
  maxIntervalMs: DAY,
};

interface SchedulerOptions {
  schedule: Schedule;
  clock: Clock;
  lastActivityAt: () => number;
  logger: Logger;
}

export function startScheduler(
  task: () => Promise<unknown>,
  { schedule, clock, lastActivityAt, logger }: SchedulerOptions,
) {
  let running: Promise<void> | undefined;
  let lastRunAt = 0;
  const run = () => {
    lastRunAt = clock.now().getTime();
    running = task()
      .then(() => undefined)
      .catch((err: unknown) => logger.error({ err }, 'Scheduled job failed'))
      .finally(() => {
        running = undefined;
      });
  };
  const isDue = () => {
    const now = clock.now().getTime();
    const sinceRun = now - lastRunAt;
    const active = now - lastActivityAt() <= schedule.activeWithinMs;
    return sinceRun >= schedule.maxIntervalMs || (sinceRun >= schedule.minIntervalMs && active);
  };
  const timer = setInterval(() => {
    if (!running && isDue()) run();
  }, schedule.checkEveryMs);
  run();
  return {
    stop(): void {
      clearInterval(timer);
    },
    settled(): Promise<void> {
      return running ?? Promise.resolve();
    },
  };
}
