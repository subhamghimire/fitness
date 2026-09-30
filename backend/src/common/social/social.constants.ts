/**
 * SOCIAL PLATFORM — SHARED CONTENT + ABUSE LIMITS
 * ---------------------------------------------------------------------------
 * One place for every number the social modules agree on, so a limit can never
 * drift between the DTO that advertises it, the service that enforces it and
 * the database CHECK constraint that backs it up.
 *
 * These are deliberately *product* limits, not infrastructure tuning. The
 * infrastructure-side numbers (feed cache TTLs, ranker weights) live next to
 * the code that uses them; the values here are the ones a client is allowed to
 * rely on, and the ones an operator would expect to find in one place.
 */

/** Maximum accepted body length, in characters (not bytes). */
export const SOCIAL_CONTENT_LIMITS = {
  /** Post body / caption. Matches the longest caption a mobile composer allows. */
  POST_BODY_MAX_LENGTH: 2200,
  /** Comment body. Short enough to stay readable in a thread. */
  COMMENT_BODY_MAX_LENGTH: 1000,
  /** Free-text field on a report. */
  REPORT_DETAILS_MAX_LENGTH: 1000
} as const;

/**
 * Per-user, per-action write quotas enforced by `SocialRateLimiter` (Redis,
 * shared across app instances).
 *
 * These sit *behind* the HTTP throttler, not instead of it:
 *
 *   - `ThrottlerGuard` (60 req/min globally, plus per-route `@Throttle`) is a
 *     cheap in-process guard against a runaway client.
 *   - these quotas are the ones that matter for abuse, because they are
 *     expressed in *content actions* ("how many posts per hour may this account
 *     publish") rather than requests, and they hold across instances.
 *
 * A quota that is too tight breaks honest power users, so the write actions are
 * sized for a heavy-but-legitimate poster (a dozen posts an hour, a few dozen
 * comments) and the destructive/idempotent actions are looser.
 */
export const SOCIAL_RATE_LIMITS = {
  post: { limit: 12, windowSeconds: 3600 },
  comment: { limit: 30, windowSeconds: 600 },
  like: { limit: 120, windowSeconds: 60 },
  follow: { limit: 30, windowSeconds: 3600 },
  block: { limit: 60, windowSeconds: 3600 },
  report: { limit: 5, windowSeconds: 86400 }
} as const;

/** Actions a user can be rate limited on. Keys of `SOCIAL_RATE_LIMITS`. */
export type SocialRateLimitedAction = keyof typeof SOCIAL_RATE_LIMITS;

export interface SocialRateLimit {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Redis key namespace. One prefix per concern, so a key can be dropped by pattern. */
export const SOCIAL_REDIS_KEYS = {
  rateLimit: (action: string, userId: string, windowStart: number): string => `social:rl:${action}:${userId}:${windowStart}`,
  following: (userId: string): string => `social:graph:following:${userId}`,
  blocked: (userId: string): string => `social:graph:blocked:${userId}`,
  followerCounts: (userId: string): string => `social:graph:counts:${userId}`,
  /**
   * First-page feed ids for one viewer, scope, ranking and page size.
   *
   * `limit` is part of the key on purpose: a cached list is a *page*, and
   * serving a 20-item list to a client that asked for 50 would be a silent
   * truncation that looks like "the feed ended".
   */
  feedFirstPage: (userId: string, scope: string, strategy: string, limit: number): string => `social:feed:${userId}:${scope}:${strategy}:${limit}`
} as const;

/**
 * Short TTLs for the cached graph projections (`followingIds`, `blockedIds`,
 * follower counts).
 *
 * The cache exists to keep a feed read at a fixed query count; it is invalidated
 * explicitly on every write that can change it (follow, unfollow, block,
 * unblock), so the TTL is only a safety net for a missed invalidation, not the
 * correctness mechanism.
 *
 * There is deliberately **no** cached follower-id set. The follower *list* is
 * keyset-paginated, so nobody needs all of it at once, and materialising it per
 * user would be the one projection big enough to hurt. Only the three sets a
 * read genuinely needs in full are cached.
 */
export const SOCIAL_CACHE_TTL = {
  /** Follow-graph membership (which authors feed a viewer may see). */
  followingSeconds: 60,
  /** Blocked-user set, in both directions. */
  blockedSeconds: 60,
  /** Follower / following counters, which are COUNT(*) queries. */
  followerCountsSeconds: 30,
  /**
   * The cached *first page* of a feed — ordered post ids, nothing else.
   *
   * Short by design, and short for a reason: the rows are always re-read from
   * Postgres and re-filtered by the visibility predicate, so this cache can only
   * ever be stale about ordering, never about access. At two seconds the
   * staleness is below the threshold a human can perceive, and the whole
   * structure is cheap to delete (`social:feed:*`) if it ever misbehaves.
   *
   * Deliberately not cached for paged requests — see `FeedService`.
   */
  feedFirstPageSeconds: 2
} as const;

/** Cursor pages are always bounded; a client that asks for more is a bug or an attack. */
export const SOCIAL_PAGE_LIMITS = {
  defaultLimit: 20,
  maxLimit: 50
} as const;
