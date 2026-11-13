export class QueueFullError extends Error {
  constructor() {
    super('Too many tasks waiting');
    this.name = 'QueueFullError';
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxWaiting = Number.POSITIVE_INFINITY,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      if (this.waiting.length >= this.maxWaiting) throw new QueueFullError();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
