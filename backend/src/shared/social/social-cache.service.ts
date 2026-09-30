import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import Redis from "ioredis";
import { RedisConnectionFactory } from "../redis/redis-connection.factory";

/**
 * SOCIAL CACHE
 * ---------------------------------------------------------------------------
 * A thin, *fail-soft* Redis cache for the social graph projections the read
 * path needs on every request: "who does this viewer follow", "who is this
 * viewer blocked by / blocking", and the follower counters.
 *
 * Why it exists at all: without it, a single feed read has to resolve the
 * follow graph, the block graph and the counters in separate queries before it
 * can even scope the post query. Caching those three projections turns the read
 * path into a fixed number of round-trips.
 *
 * Why it is *not* a correctness mechanism:
 *
 *   - Every write that can change a cached projection invalidates it explicitly
 *     (follow, unfollow, block, unblock). The TTL is a safety net against a
 *     missed invalidation, not the thing that makes a stale read impossible.
 *   - Every operation degrades to "no cache" when Redis is unavailable. A cache
 *     outage must slow the product down, never take it down, so `get` returns
 *     `null` and `set`/`del` log and swallow. The one exception is the
 *     rate limiter, which has its own explicit policy.
 *
 * The client is created lazily and owned by the shared `RedisConnectionFactory`
 * (which registers it for shutdown), so this service never leaks a socket and
 * never spawns a second pool.
 */
@Injectable()
export class SocialCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(SocialCacheService.name);
  private client: Redis | null = null;

  constructor(private readonly redisFactory: RedisConnectionFactory) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis().get(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      this.warn("get", key, error);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis().set(key, JSON.stringify(value), "EX", Math.max(1, Math.floor(ttlSeconds)));
    } catch (error) {
      this.warn("set", key, error);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis().del(...keys);
    } catch (error) {
      this.warn("del", keys.join(","), error);
    }
  }

  /**
   * Read-through helper.
   *
   * `factory` runs on a miss *and* on a Redis failure, so callers never have to
   * branch on cache availability. A rejected factory is propagated unchanged —
   * a database failure must not be reported as a cache miss.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  private redis(): Redis {
    // `lazyConnect: false` + a single cached client: the factory tracks it for
    // shutdown, and callers never have to think about connection state.
    this.client ??= this.redisFactory.createClient();
    return this.client;
  }

  private warn(operation: string, key: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis ${operation} failed for ${key}: ${message} (continuing without cache)`);
  }

  onApplicationShutdown(): void {
    // Drops the handle so nothing can reconnect or issue a command during
    // teardown. Sync on purpose: this is process-exit bookkeeping, and the
    // hook's contract is a completed shutdown, not a graceful drain.
    this.client = null;
  }
}
