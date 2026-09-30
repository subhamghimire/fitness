import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { SOCIAL_CACHE_TTL, SOCIAL_REDIS_KEYS } from "src/common/social";
import { SocialCacheService } from "src/shared/social";
import { Follow, UserBlock } from "./entities";

/** Follower / following counters for one user. */
export interface FollowCounts {
  followerCount: number;
  followingCount: number;
}

/**
 * SOCIAL GRAPH READ MODEL
 * ---------------------------------------------------------------------------
 * The single place that answers "who does this viewer follow", "who is this
 * viewer blocked by" and "how many followers does this user have". Every other
 * social module reads the graph through here rather than touching
 * `social_follows` / `social_blocks` directly, which is what makes three things
 * true at once:
 *
 *   1. **The cache is invalidated in one place.** Every write path calls
 *      `invalidate(...userIds)`; nothing else in the codebase is allowed to write
 *      a graph row. A module that forgot to invalidate would be invisible,
 *      because there is no second reader to be stale instead.
 *   2. **Blocking is symmetric in reads, directional in storage.** A block is
 *      one row, but `blockedUserIds` returns the union of "people I blocked" and
 *      "people who blocked me". A one-way block is trivially circumvented by
 *      signing in on another device, so enforcement has to be mutual even though
 *      the write is not.
 *   3. **The read path is a fixed number of round-trips.** A feed read needs the
 *      follow set and the block set before it can scope the post query; the
 *      cached projections are what let that stay constant instead of growing
 *      with the size of the graph.
 *
 * ── Why the manager parameter ───────────────────────────────────────────────
 * Every read accepts an optional `EntityManager` so callers inside a
 * transaction (block, unblock) see their own uncommitted writes. Nothing here
 * caches inside a transaction: a value read through a manager that later rolls
 * back must not be memoised.
 *
 * ── What is *not* here ──────────────────────────────────────────────────────
 * No follower-id set. The follower *list* is keyset-paginated, so no read ever
 * needs it in full, and it is the one projection large enough that caching it
 * per user would cost more than it saves.
 */
@Injectable()
export class SocialGraphService {
  constructor(
    @InjectRepository(Follow) private readonly followsRepo: Repository<Follow>,
    @InjectRepository(UserBlock) private readonly blocksRepo: Repository<UserBlock>,
    private readonly cache: SocialCacheService
  ) {}

  /**
   * Ids of everyone the user follows (live edges only).
   *
   * The feed's author scope. Returns `[]` — not a query — when the user follows
   * nobody, so the feed can short-circuit to an empty page.
   */
  async followingIds(userId: string, manager?: EntityManager): Promise<string[]> {
    if (manager) return this.loadFollowing(userId, manager);
    return this.cache.getOrSet(SOCIAL_REDIS_KEYS.following(userId), SOCIAL_CACHE_TTL.followingSeconds, () => this.loadFollowing(userId));
  }

  /**
   * Everyone in a mutual block with the user, in both directions.
   *
   * Merging the two directions here is the whole enforcement story: every read
   * that includes posts, comments or likes subtracts this set, so a blocked pair
   * stops seeing each other no matter which side pressed the button.
   */
  async blockedUserIds(userId: string, manager?: EntityManager): Promise<string[]> {
    if (manager) return this.loadBlocked(userId, manager);
    return this.cache.getOrSet(SOCIAL_REDIS_KEYS.blocked(userId), SOCIAL_CACHE_TTL.blockedSeconds, () => this.loadBlocked(userId));
  }

  /** Live follower and following counters, cached together so a profile costs one read. */
  async followCounts(userId: string, manager?: EntityManager): Promise<FollowCounts> {
    if (manager) return this.loadFollowCounts(userId, manager);
    return this.cache.getOrSet(SOCIAL_REDIS_KEYS.followerCounts(userId), SOCIAL_CACHE_TTL.followerCountsSeconds, () => this.loadFollowCounts(userId));
  }

  /** Point read: does this specific edge exist? Never cached — it is one indexed lookup. */
  async isFollowing(followerId: string, followingId: string, manager?: EntityManager): Promise<boolean> {
    const repo = manager ? manager.getRepository(Follow) : this.followsRepo;
    const found = await repo.findOne({ where: { followerId, followingId, isDeleted: false }, select: { id: true } });
    return found !== null;
  }

  /** Point read: is there a live block in *either* direction between these two users? */
  async isBlockedEitherDirection(userId: string, otherId: string, manager?: EntityManager): Promise<boolean> {
    const repo = manager ? manager.getRepository(UserBlock) : this.blocksRepo;
    const found = await repo
      .createQueryBuilder("block")
      .where('"block"."isDeleted" = false')
      .andWhere("((block.blockerId = :userId AND block.blockedId = :otherId) OR (block.blockerId = :otherId AND block.blockedId = :userId))", { userId, otherId })
      .getOne();
    return found !== null;
  }

  /**
   * Drops every cached projection for the given users.
   *
   * Called after (not inside) each graph write. Both sides of an edge are always
   * passed: a follow changes the follower's "following" set *and* the followee's
   * follower counter, and passing only the actor is the classic way to ship a
   * stale count.
   */
  async invalidate(...userIds: (string | null | undefined)[]): Promise<void> {
    const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (ids.length === 0) return;
    const keys: string[] = [];
    for (const id of ids) {
      keys.push(SOCIAL_REDIS_KEYS.following(id), SOCIAL_REDIS_KEYS.blocked(id), SOCIAL_REDIS_KEYS.followerCounts(id));
    }
    await this.cache.del(...keys);
  }

  private async loadFollowing(userId: string, manager?: EntityManager): Promise<string[]> {
    const repo = manager ? manager.getRepository(Follow) : this.followsRepo;
    const rows = await repo.find({ where: { followerId: userId, isDeleted: false }, select: { followingId: true } });
    return rows.map((row) => row.followingId);
  }

  private async loadBlocked(userId: string, manager?: EntityManager): Promise<string[]> {
    const repo = manager ? manager.getRepository(UserBlock) : this.blocksRepo;
    const outgoing = await repo.find({ where: { blockerId: userId, isDeleted: false }, select: { blockedId: true } });
    const incoming = await repo.find({ where: { blockedId: userId, isDeleted: false }, select: { blockerId: true } });
    return [...new Set([...outgoing.map((row) => row.blockedId), ...incoming.map((row) => row.blockerId)])];
  }

  private async loadFollowCounts(userId: string, manager?: EntityManager): Promise<FollowCounts> {
    const repo = manager ? manager.getRepository(Follow) : this.followsRepo;
    const [followerCount, followingCount] = await Promise.all([
      repo.count({ where: { followingId: userId, isDeleted: false } }),
      repo.count({ where: { followerId: userId, isDeleted: false } })
    ]);
    return { followerCount, followingCount };
  }
}
