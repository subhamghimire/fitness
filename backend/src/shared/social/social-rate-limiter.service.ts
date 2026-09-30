import { Injectable, Logger } from "@nestjs/common";
import { SocialRateLimit, SocialRateLimitedAction, SocialRateLimitException, SOCIAL_RATE_LIMITS, SOCIAL_REDIS_KEYS } from "src/common/social";
import { RedisConnectionFactory } from "../redis/redis-connection.factory";
import Redis from "ioredis";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends; 0 when the action is allowed. */
  retryAfterSeconds: number;
}

/**
 * SOCIAL RATE LIMITER
 * ---------------------------------------------------------------------------
 * Per-user, per-action write quotas held in Redis, so the limit is the same on
 * every app instance. `ThrottlerGuard` (already global) bounds *requests per
 * process*; this bounds *content actions per account*, which is the thing abuse
 * actually looks like.
 *
 * ── Fixed window, and why that is the right trade here ───────────────────────
 * The counter is `INCR` on a key that includes the window start, with the TTL
 * set on first write. One round trip on the hot path, no Lua, no sorted set.
 * A fixed window can let through up to `2 × limit` across a window boundary
 * (burst at 11:59:59 plus burst at 12:00:00). That is an acceptable trade for
 * *content* actions with a multi-minute window, where a sliding window would
 * buy precision nobody can observe; if a limit ever needs to be tight enough
 * for that to matter (say, per-second API limits), it should move to a
 * `RateLimitGuard` over the throttler's storage adapter, not acquire a
 * multi-key Lua script here.
 *
 * ── Failure policy: fail OPEN, loudly ───────────────────────────────────────
 * If Redis is unavailable the action is allowed and the failure is logged. The
 * alternative — failing closed — would let a cache outage delete every post,
 * comment and like in the product, which is a far worse outcome than a brief
 * window of un-metered writes. Every other layer of abuse protection (content
 * length, validation, duplicate prevention, authorization, soft delete) lives in
 * the database and keeps working regardless.
 */
@Injectable()
export class SocialRateLimiter {
  private readonly logger = new Logger(SocialRateLimiter.name);
  private client: Redis | null = null;

  constructor(private readonly redisFactory: RedisConnectionFactory) {}

  /**
   * Counts one action against a user's quota.
   *
   * Call this *after* authorization and validation, immediately before the
   * write: a rejected request must not consume quota, and a request that fails
   * validation should not be able to burn a user's own limit.
   */
  async consume(action: SocialRateLimitedAction, userId: string, now: Date = new Date()): Promise<RateLimitDecision> {
    const quota: SocialRateLimit = SOCIAL_RATE_LIMITS[action];
    const windowMs = quota.windowSeconds * 1000;
    const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
    const windowEndsAt = windowStart + windowMs;
    const key = SOCIAL_REDIS_KEYS.rateLimit(action, userId, windowStart);

    try {
      const client = this.redis();
      const count = await client.incr(key);
      // The window is encoded in the key, so the TTL only has to outlive the
      // remainder of the window. Re-asserting it when it is missing keeps a key
      // that lost its TTL (a Redis restart mid-window) from living forever.
      if (count === 1 || (await client.ttl(key)) < 0) await client.expire(key, quota.windowSeconds);

      const allowed = count <= quota.limit;
      return {
        allowed,
        limit: quota.limit,
        remaining: Math.max(0, quota.limit - count),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((windowEndsAt - now.getTime()) / 1000))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rate limit check failed for ${action}/${userId}: ${message} (failing open)`);
      return { allowed: true, limit: quota.limit, remaining: quota.limit, retryAfterSeconds: 0 };
    }
  }

  /** Throws the 429 the client sees. Kept here so every caller phrases it identically. */
  assertAllowed(action: SocialRateLimitedAction, decision: RateLimitDecision): void {
    if (decision.allowed) return;
    throw new SocialRateLimitException(action, decision.retryAfterSeconds, decision.limit);
  }

  private redis(): Redis {
    this.client ??= this.redisFactory.createClient();
    return this.client;
  }
}
