import type { Clock } from './clock.js';

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private version = 0;

  constructor(
    private readonly clock: Clock,
    private readonly ttl: number,
    private readonly maxEntries: number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  async resolve<T extends V | undefined>(key: string, load: () => Promise<T>): Promise<T | V> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.clock.now().getTime()) return cached.value;
    const version = this.version;
    const value = await load();
    if (value !== undefined && this.version === version) this.store(key, value);
    return value;
  }

  delete(key: string): void {
    this.version += 1;
    this.entries.delete(key);
  }

  deleteWhere(matches: (value: V) => boolean): void {
    this.version += 1;
    for (const [key, entry] of this.entries) if (matches(entry.value)) this.entries.delete(key);
  }

  private store(key: string, value: V): void {
    const now = this.clock.now().getTime();
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey);
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttl });
  }
}
