import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';

const TTL = 10 * MINUTE;
const SWEEP_ABOVE = 1000;

export class UnreadCounter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private readonly loads = new Map<string, symbol>();

  constructor(private readonly clock: Clock) {}

  get size(): number {
    return this.entries.size;
  }

  async count(key: string, load: () => Promise<number>): Promise<number> {
    const now = this.clock.now().getTime();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.count;
    const ticket = Symbol(key);
    this.loads.set(key, ticket);
    try {
      const count = await load();
      if (this.loads.get(key) === ticket) this.store(key, count, now);
      return count;
    } finally {
      if (this.loads.get(key) === ticket) this.loads.delete(key);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.loads.delete(key);
  }

  private store(key: string, count: number, now: number): void {
    if (this.entries.size >= SWEEP_ABOVE) {
      for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    this.entries.set(key, { count, expiresAt: now + TTL });
  }
}
