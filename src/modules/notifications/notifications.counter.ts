import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';

const TTL = 10 * MINUTE;

export class UnreadCounter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private readonly loads = new Map<string, symbol>();

  constructor(private readonly clock: Clock) {}

  async count(key: string, load: () => Promise<number>): Promise<number> {
    const now = this.clock.now().getTime();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now) return cached.count;
    const ticket = Symbol(key);
    this.loads.set(key, ticket);
    const count = await load();
    if (this.loads.get(key) === ticket) {
      this.loads.delete(key);
      this.entries.set(key, { count, expiresAt: now + TTL });
    }
    return count;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.loads.delete(key);
  }
}
