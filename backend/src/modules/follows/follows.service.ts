import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, SelectQueryBuilder } from "typeorm";
import { CursorPageMetaDto } from "src/common/dto";
import { buildIdempotencyKey, DomainAggregateType, DomainEventPublisher, DomainEventType, NewFollowerEvent } from "src/common/events";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, toCursorPage } from "src/common/social";
import { SocialRateLimiter, SocialUserLoader, SocialUserPresenter } from "src/shared/social";
import { User } from "src/modules/users/entities/user.entity";
import { FOLLOW_LIST_CURSOR_STRATEGY, FollowListQueryDto, FollowListResponseDto, FollowStateResponseDto, FollowUserResponseDto } from "./dto";
import { Follow, UserBlock } from "./entities";
import { SocialGraphService } from "./social-graph.service";

/**
 * FOLLOWS SERVICE
 * ---------------------------------------------------------------------------
 * The follow graph: one directed edge per (follower, following) pair, with
 * keyset-paginated follower/following lists and a single state endpoint a client
 * uses to decide which buttons to render.
 *
 * ─── Why every write is a three-step check, and what actually guarantees it ──
 * A follow is validated in this order:
 *
 *   1. not yourself — a self-follow is a data error, not a social act, and it
 *      would otherwise inflate every follower count in the product;
 *   2. not blocked in either direction — enforced here *and* in the read path.
 *      A check that only exists on the write can be raced (block arrives right
 *      after the follow commits); a check that only exists on the read leaves a
 *      live edge in the graph that nothing will ever surface. Both are needed
 *      and they are not redundant.
 *   3. no live edge already — checked here for a good error message, but the
 *      real guarantee is `uk_social_follows_pair`, a *partial* unique index.
 *
 * That index is the point. Two concurrent follows of the same person both pass
 * step 3; exactly one INSERT survives, the loser gets 23505, and that is
 * translated to a 409 rather than surfacing as a 500. A read-then-write check on
 * its own would let both edges through.
 *
 * ─── Events ─────────────────────────────────────────────────────────────────
 * `NEW_FOLLOWER` is published *after* the commit, via
 * `DomainEventPublisher.publish` (which enqueues onto the outbox and never
 * rejects). Coupling a one-row social insert to the notification pipeline's
 * transaction would buy no atomicity that matters here and would make a
 * notification-schema problem look like a follow failure.
 */
@Injectable()
export class FollowsService {
  constructor(
    @InjectRepository(Follow) private readonly followsRepo: Repository<Follow>,
    @InjectRepository(UserBlock) private readonly blocksRepo: Repository<UserBlock>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly graph: SocialGraphService,
    private readonly userLoader: SocialUserLoader,
    private readonly userPresenter: SocialUserPresenter,
    private readonly rateLimiter: SocialRateLimiter,
    private readonly eventPublisher: DomainEventPublisher,
    private readonly dataSource: DataSource
  ) {}

  // ─── Writes ────────────────────────────────────────────────────────────────

  /**
   * Follow a user.
   *
   * Idempotency is deliberately *not* offered: a second call returns 409, because
   * "I already follow you" and "I just followed you" are different facts and a
   * client that cannot tell them apart mis-renders the button. A client that
   * retries blindly should treat 409 as success — the state it wanted is true.
   */
  async follow(userId: string, targetId: string): Promise<FollowStateResponseDto> {
    if (userId === targetId) throw new BadRequestException("You cannot follow yourself");

    // The quota is consumed after validation and immediately before the write,
    // so a rejected request never burns the caller's own allowance.
    this.rateLimiter.assertAllowed("follow", await this.rateLimiter.consume("follow", userId));

    const { actor, target } = await this.loadFollowPair(userId, targetId);
    if (await this.graph.isBlockedEitherDirection(userId, targetId)) throw new ConflictException("You cannot follow this user");
    if (await this.followsRepo.findOne({ where: { followerId: userId, followingId: targetId, isDeleted: false }, select: { id: true } })) {
      throw new ConflictException("You already follow this user");
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Follow);
        await repo.save(repo.create({ followerId: userId, followingId: targetId, isDeleted: false }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("You already follow this user");
      throw error;
    }

    // Invalidate *both* sides: the follower's "following" set and the followee's
    // follower counter are two different cached projections of one write.
    await this.graph.invalidate(userId, targetId);
    await this.announceNewFollower(actor, target);
    return this.getState(userId, targetId);
  }

  /**
   * Unfollow. Idempotent by design — unlike `follow`, a repeat here is the
   * normal shape of a client that optimistically decrements a counter and then
   * retries, so 404-ing it would be a false alarm.
   */
  async unfollow(userId: string, targetId: string): Promise<FollowStateResponseDto> {
    if (userId === targetId) throw new BadRequestException("You cannot unfollow yourself");

    const existing = await this.followsRepo.findOne({ where: { followerId: userId, followingId: targetId, isDeleted: false }, select: { id: true } });
    if (existing) {
      // Soft delete, not a row delete: the graph keeps the record of the edge,
      // which is what lets a later re-follow be distinguished from a first
      // follow — and what keeps the partial unique index honest (a re-follow
      // inserts a fresh row, it does not revive this one).
      await this.followsRepo.update({ id: existing.id }, { isDeleted: true, deletedAt: new Date(), deletedBy: userId });
      await this.graph.invalidate(userId, targetId);
    }
    return this.getState(userId, targetId);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Who follows `userId`, newest first.
   *
   * Keyset-paginated on `(created_at, id)`, which is exactly the shape of
   * `idx_social_follows_following_created`: the seek is an index range scan, and
   * a follower arriving mid-pagination can neither duplicate nor hide a row the
   * client has not seen.
   */
  async listFollowers(userId: string, query: FollowListQueryDto): Promise<FollowListResponseDto> {
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, FOLLOW_LIST_CURSOR_STRATEGY) : null;
    const qb = this.followsRepo
      .createQueryBuilder("follow")
      .where("follow.followingId = :userId", { userId })
      .andWhere("follow.isDeleted = false")
      .orderBy("follow.createdAt", "DESC")
      .addOrderBy("follow.id", "DESC")
      .take(query.limit + 1);
    if (cursor) applyKeyset(qb, cursor.k);

    const rows = await qb.getMany();
    const users = await this.userLoader.loadByIds(rows.map((row) => row.followerId));
    // The page envelope is built from the *edge* rows, not the hydrated ones, so
    // `hasMore` and `nextCursor` describe the same sequence the client walked —
    // a missing (deleted) user must not silently shorten a page.
    const page = toCursorPage(rows, query.limit, (row) =>
      encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: FOLLOW_LIST_CURSOR_STRATEGY, k: [row.createdAt.toISOString(), row.id] })
    );
    const data: FollowUserResponseDto[] = rows.slice(0, query.limit).flatMap((row) => {
      const user = users.get(row.followerId);
      return user ? [{ ...user, followedAt: row.createdAt }] : [];
    });
    const meta: CursorPageMetaDto = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    return { data, meta };
  }

  /** Who `userId` follows, most recently followed first. Mirror of {@link listFollowers}. */
  async listFollowing(userId: string, query: FollowListQueryDto): Promise<FollowListResponseDto> {
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, FOLLOW_LIST_CURSOR_STRATEGY) : null;
    const qb = this.followsRepo
      .createQueryBuilder("follow")
      .where("follow.followerId = :userId", { userId })
      .andWhere("follow.isDeleted = false")
      .orderBy("follow.createdAt", "DESC")
      .addOrderBy("follow.id", "DESC")
      .take(query.limit + 1);
    if (cursor) applyKeyset(qb, cursor.k);

    const rows = await qb.getMany();
    const users = await this.userLoader.loadByIds(rows.map((row) => row.followingId));
    const page = toCursorPage(rows, query.limit, (row) =>
      encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: FOLLOW_LIST_CURSOR_STRATEGY, k: [row.createdAt.toISOString(), row.id] })
    );
    const data: FollowUserResponseDto[] = rows.slice(0, query.limit).flatMap((row) => {
      const user = users.get(row.followingId);
      return user ? [{ ...user, followedAt: row.createdAt }] : [];
    });
    const meta: CursorPageMetaDto = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    return { data, meta };
  }

  /**
   * The full relationship between the caller and `targetId`, in one response.
   *
   * Uses the cached graph projections rather than five point reads, which is what
   * makes "render a profile's follow button" one request instead of a waterfall —
   * and, more importantly, one snapshot of the graph instead of five that can
   * disagree with each other mid-flight.
   */
  async getState(userId: string, targetId: string): Promise<FollowStateResponseDto> {
    if (userId === targetId) throw new BadRequestException("You cannot query your own relationship");
    const target = await this.requireLiveUser(targetId);

    const [followingIds, counts, isFollowedBy, iBlockedThem, theyBlockedMe] = await Promise.all([
      this.graph.followingIds(userId),
      this.graph.followCounts(targetId),
      this.graph.isFollowing(targetId, userId),
      this.blocksRepo.findOne({ where: { blockerId: userId, blockedId: targetId, isDeleted: false }, select: { id: true } }),
      this.blocksRepo.findOne({ where: { blockerId: targetId, blockedId: userId, isDeleted: false }, select: { id: true } })
    ]);

    return {
      user: this.userPresenter.toSummary(target),
      isFollowing: followingIds.includes(targetId),
      isFollowedBy,
      // Directional: `isBlocked` = I blocked them, `isBlockedBy` = they blocked
      // me. The cached symmetric set cannot answer either on its own, so both
      // are point reads.
      isBlocked: iBlockedThem !== null,
      isBlockedBy: theyBlockedMe !== null,
      followerCount: counts.followerCount,
      followingCount: counts.followingCount
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** Both endpoints of the edge, in one query, so the event needs no extra read. */
  private async loadFollowPair(userId: string, targetId: string): Promise<{ actor: User; target: User }> {
    if (userId === targetId) throw new BadRequestException("You cannot follow yourself");
    const rows = await this.usersRepo.find({ where: { id: In([userId, targetId]), isDeleted: false } });
    const actor = rows.find((row) => row.id === userId);
    const target = rows.find((row) => row.id === targetId);
    // A soft-deleted account must not be followable: it would keep showing up in
    // follower lists and in a feed's author scope with no way to remove it.
    if (!actor || !target) throw new NotFoundException("User not found");
    return { actor, target };
  }

  private async requireLiveUser(userId: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id: userId, isDeleted: false } });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  private async announceNewFollower(actor: User, target: User): Promise<void> {
    // The pair *is* the aggregate id. A re-follow after an unfollow creates a new
    // edge row, so the same pair legitimately produces two notifications and the
    // key must not collapse them.
    const pairId = `${actor.id}->${target.id}`;
    const event: NewFollowerEvent = {
      type: DomainEventType.NEW_FOLLOWER,
      occurredAt: new Date(),
      idempotencyKey: buildIdempotencyKey(DomainEventType.NEW_FOLLOWER, pairId),
      actorId: actor.id,
      audience: { kind: "users", userIds: [target.id], excludeActor: true },
      aggregate: { type: DomainAggregateType.FOLLOW, id: pairId },
      payload: { followerId: actor.id, followerName: actor.name ?? null }
    };
    await this.eventPublisher.publish(event);
  }
}

/** Postgres 23505 — the partial unique index refused the row. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Applies a keyset seek as a **row-tuple** comparison: `(created_at, id) < (:t, :id)`.
 *
 * The row form is not a stylistic choice. The equivalent
 * `created_at < :t OR (created_at = :t AND id < :id)` needs a disjunction and
 * cannot always be turned into a single index range scan, whereas Postgres treats
 * the row comparison as one seek on the composite index. The `id` tiebreaker is
 * what makes the ordering *total*: without it, two rows sharing a `created_at`
 * can straddle a page boundary and one of them is silently skipped forever.
 */
function applyKeyset(qb: SelectQueryBuilder<Follow>, keys: string[]): void {
  if (keys.length !== 2) throw new BadRequestException("Malformed cursor");
  qb.andWhere("(follow.createdAt, follow.id) < (:cursorCreatedAt, :cursorId)", { cursorCreatedAt: new Date(keys[0]), cursorId: keys[1] });
}
