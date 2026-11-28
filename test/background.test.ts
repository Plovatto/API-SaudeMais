import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/config/logger.js';
import { runInBackground } from '@/lib/background.js';

describe('runInBackground', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the task only after the caller moves on', async () => {
    const task = vi.fn(() => Promise.resolve());

    runInBackground(task, 'Task failed');

    expect(task).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce());
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('boom'))],
    [
      'throws',
      () => {
        throw new Error('boom');
      },
    ],
  ])('logs a task that %s instead of crashing the process', async (_case, task) => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    runInBackground(task, 'Task failed');

    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ err: expect.objectContaining({ message: 'boom' }) as unknown }, 'Task failed'),
    );
  });
});
