interface TtlCacheEntry<V> {
  value: V;
  expiresAt: number;
}

/**
 * Minimal in-process TTL cache used for expensive, frequently-polled dashboard
 * reads (coach dashboard overview / client list). Entries expire lazily on read
 * and the cache is bounded (oldest entry evicted FIFO once full). This is a
 * single-process cache deliberately: dashboards tolerate a few seconds of
 * staleness, and a distributed cache would add infrastructure that the read
 * profile does not justify.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, TtlCacheEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 1000
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}