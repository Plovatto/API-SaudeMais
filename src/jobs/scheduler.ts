import type { Logger } from 'pino';

export function startScheduler(task: () => Promise<unknown>, intervalMs: number, logger: Logger) {
  let running: Promise<void> | undefined;
  const tick = () => {
    running ??= task()
      .then(() => undefined)
      .catch((err: unknown) => logger.error({ err }, 'Scheduled job failed'))
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await running;
    },
  };
}
