import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { SOCIAL_PAGE_LIMITS } from "src/common/social";
import { SocialRateLimiter } from "src/shared/social";
import { Post } from "src/modules/posts/entities";
import { PostEngagementService } from "src/modules/posts/post-engagement.service";
import { PostVisibilityContext, PostVisibilityService } from "src/modules/posts/post-visibility.service";
import { LikeResultDto, LikeStateRequestDto, LikeStateResponseDto, PostLikeStateDto } from "./dto";
import { PostLike } from "./entities";

/**
 * LIKES SERVICE
 * ---------------------------------------------------------------------------
 * Owns `post_likes` and nothing else. It never reads the `Post` repository and
 * never writes a `Post` row: counters move through `PostEngagementService`, which
 * is why `LikesModule ──▶ PostsModule` and not the reverse.
 *
 * ─── The rule this module exists to get right ───────────────────────────────
 * A like is two facts that must never disagree: *this user has a live like on
 * this post* and *the post's `like_count` includes it*. Every design choice here
 * serves that invariant.
 *
 * ─── Why the write and the counter share a transaction ─────────────────────
 * They are not two updates that happen to be adjacent. If the like row commits
 * and the counter statement does not, the post shows a number that is wrong
 * forever, and there is no repair path short of a recount job. So:
 *
 *   like    ──▶ BEGIN ──▶ INSERT post_likes ──▶ UPDATE posts SET like_count = …
 *   unlike  ──▶ BEGIN ──▶ UPDATE post_likes (soft) ──▶ [if matched] UPDATE posts
 *            ──▶ COMMIT
 *
 * The same `EntityManager` is threaded through both statements, so the two facts
 * are one atomic write. A failure anywhere in the pair leaves the database in
 * the state it was in before.
 *
 * ─── Why `unlike` gates the decrement on the affected-row count ─────────────
 * This is the subtle half. The soft delete's matched-row count is the *only*
 * honest signal that this call is the one that removed the like. Two clients
 * unliking the same post concurrently, or one client retrying after a dropped
 * response, both produce "the row is already gone" for the loser — and a naive
 * implementation decrements anyway, driving the counter below the truth. By
 * reading `affected` and only decrementing when it is greater than zero, the
 * counter moves exactly as many times as the fact did, no matter how many times
 * the endpoint is called.
 *
 * ─── Why like is *not* idempotent ───────────────────────────────────────────
 * The mirror of the above: a second like returns 409, not 200. "I just liked
 * this" and "you already liked this" are different responses and a client that
 * conflates them will double-render. Unlike, by contrast, *is* idempotent,
 * because a repeat there is the normal shape of an optimistic UI decrementing a
 * counter it already showed. A client that receives 409 should treat it as
 * success — the state it asked for is true.
 */
@Injectable()
export class LikesService {
  constructor(
    @InjectRepository(PostLike) private readonly likesRepo: Repository<PostLike>,
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    private readonly visibility: PostVisibilityService,
    private readonly engagement: PostEngagementService,
    private readonly rateLimiter: SocialRateLimiter,
    private readonly dataSource: DataSource
  ) {}

  // ─── Writes ────────────────────────────────────────────────────────────────

  /**
   * Like a post.
   *
   * A like is a social signal, so it is refused on the same grounds a follow is:
   * the post must be visible to the caller, and the author must not be in a
   * mutual block with them. Both checks run before the quota is consumed, so a
   * rejected request costs the caller nothing.
   */
  async like(userId: string, postId: string): Promise<LikeResultDto> {
    const post = await this.requireViewablePost(userId, postId);

    this.rateLimiter.assertAllowed("like", await this.rateLimiter.consume("like", userId));

    try {
      // The counter read happens *after* the insert inside the same transaction
      // so the returned number is the post-insert value, not a stale one.
      const likeCount = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PostLike);
        await repo.save(repo.create({ postId, userId, isDeleted: false }));
        await this.engagement.adjustLikes(manager, post.id, 1);
        const updated = await this.postsRepo.findOne({ where: { id: post.id }, select: { likeCount: true } });
        return updated?.likeCount ?? post.likeCount + 1;
      });
      return { postId, liked: true, likeCount };
    } catch (error) {
      // `uk_post_likes_pair` is the authority for "already liked". The read
      // above is only here so a sequential double-tap gets a clean 409 instead
      // of a database error; a concurrent one lands here.
      if (isUniqueViolation(error)) throw new ConflictException("You have already liked this post");
      throw error;
    }
  }

  /**
   * Unlike a post. Idempotent, and safe to retry.
   *
   * Returns the post's `likeCount` as it stands *after* this call, which for a
   * repeat is simply the current number — a client that decrements
   * optimistically and retries therefore converges instead of drifting.
   */
  async unlike(userId: string, postId: string): Promise<LikeResultDto> {
    await this.requireViewablePost(userId, postId);

    const likeCount = await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(PostLike)
        .set({ isDeleted: true, deletedAt: new Date(), deletedBy: userId })
        .where('"post_id" = :postId', { postId })
        .andWhere('"user_id" = :userId', { userId })
        .andWhere('"isDeleted" = false')
        .execute();

      // Only the call that actually removed the live edge moves the counter.
      // See the class comment — this is what makes unlike safe to retry.
      if ((result.affected ?? 0) === 0) {
        const current = await this.postsRepo.findOne({ where: { id: postId }, select: { likeCount: true } });
        return current?.likeCount ?? 0;
      }
      await this.engagement.adjustLikes(manager, postId, -1);
      const updated = await this.postsRepo.findOne({ where: { id: postId }, select: { likeCount: true } });
      return updated?.likeCount ?? 0;
    });

    return { postId, liked: false, likeCount };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * Which of a page of posts the caller has liked, in the order requested.
   *
   * Ids the caller cannot see are reported as `liked: false` rather than omitted,
   * and the response always has one entry per requested id. A client mapping
   * states onto a rendered list can then index positionally; a response that
   * quietly dropped entries would make a heart flicker on a post the user
   * cannot see — and, more importantly, would make the state array a usable
   * existence oracle for invisible post ids.
   */
  async stateFor(userId: string, dto: LikeStateRequestDto): Promise<LikeStateResponseDto> {
    const ids = [...new Set(dto.postIds)].slice(0, SOCIAL_PAGE_LIMITS.maxLimit);
    if (ids.length === 0) return { states: [] };

    const rows = await this.likesRepo.find({ where: { userId, postId: In(ids), isDeleted: false }, select: { postId: true } });
    const liked = new Set(rows.map((row) => row.postId));

    // Visibility is *not* re-checked here. Reporting `false` for an id the
    // caller cannot see is the same answer a visible-but-unliked post gets, so
    // this endpoint cannot be used to probe which ids exist. A client that
    // renders a post it can see always has a post it can see.
    const states: PostLikeStateDto[] = ids.map((postId) => ({ postId, liked: liked.has(postId) }));
    return { states };
  }

  /** How many users have liked a post. Used by the liker list; not a page. */
  async likerCount(postId: string): Promise<number> {
    return this.likesRepo.count({ where: { postId, isDeleted: false } });
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Loads the post and asserts the caller may see it.
   *
   * Reuses `PostVisibilityService` — the same rule the post read and the feed
   * apply. A like is an interaction with content, so "can I see it" and "can I
   * like it" are the same question, and answering them in two places is how a
   * private post ends up likeable.
   */
  private async requireViewablePost(userId: string, postId: string): Promise<Post> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException("Post not found");
    const ctx: PostVisibilityContext = await this.visibility.contextFor(userId);
    this.visibility.assertViewable(post, ctx);
    return post;
  }
}

/** Postgres 23505 — the partial unique index refused the row. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
