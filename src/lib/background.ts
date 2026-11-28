import { logger } from '../config/logger.js';

export function runInBackground(task: () => Promise<unknown>, failureMessage: string): void {
  Promise.resolve()
    .then(task)
    .catch((err: unknown) => logger.error({ err }, failureMessage));
}
