import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';
import { TtlCache } from '../../lib/ttl-cache.js';
import type { ActiveSession } from './user.repository.js';

const TTL = 5 * MINUTE;
const MAX_ENTRIES = 1000;

export class SessionCache {
  private readonly entries: TtlCache<ActiveSession>;

  constructor(clock: Clock) {
    this.entries = new TtlCache(clock, TTL, MAX_ENTRIES);
  }

  resolve(tokenHash: string, load: () => Promise<ActiveSession | undefined>): Promise<ActiveSession | undefined> {
    return this.entries.resolve(tokenHash, load);
  }

  invalidate(tokenHash: string): void {
    this.entries.delete(tokenHash);
  }

  invalidateSessions(ids: string[]): void {
    if (ids.length > 0) this.entries.deleteWhere((session) => ids.includes(session.id));
  }

  invalidateUser(userId: string): void {
    this.entries.deleteWhere((session) => session.user.id === userId);
  }
}
