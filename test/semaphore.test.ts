import { describe, expect, it } from 'vitest';
import { QueueFullError, Semaphore } from '@/lib/semaphore.js';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Semaphore', () => {
  it('never runs more tasks at once than its limit, even when a slot is handed over', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    const tasks = gates.map((gate) =>
      semaphore.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );

    gates[0]?.resolve();
    await Promise.resolve();
    const late = semaphore.run(() => {
      running += 1;
      peak = Math.max(peak, running);
      running -= 1;
      return Promise.resolve();
    });
    for (const gate of gates) gate.resolve();
    await Promise.all([...tasks, late]);

    expect(peak).toBe(2);
  });

  it('refuses new work once the waiting line is full', async () => {
    const semaphore = new Semaphore(1, 1);
    const gate = deferred();
    const running = semaphore.run(() => gate.promise);
    const waiting = semaphore.run(() => Promise.resolve());

    await expect(semaphore.run(() => Promise.resolve())).rejects.toBeInstanceOf(QueueFullError);
    gate.resolve();
    await Promise.all([running, waiting]);
  });
});
