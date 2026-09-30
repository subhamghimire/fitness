import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { CursorPageMetaDto } from "src/common/dto";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, toCursorPage } from "src/common/social";
import { SocialRateLimiter } from "src/shared/social";
import { User } from "src/modules/users/entities/user.entity";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";
import { CreatePostDto, PostFeedQueryDto, PostPageResponseDto, PostQueryDto, PostResponseDto, UpdatePostDto } from "./dto";
import { PostVisibilityService } from "./post-visibility.service";
import { PostHydrator } from "./post-hydrator.service";
import { BODY_REQUIRED_TYPES, PostPrivacy, PostType } from "./enums";
import { Post } from "./entities";

/** Cursor strategy for every post list. Ordering is always `(created_at, id) DESC`. */
const POST_LIST_CURSOR_STRATEGY = "post_created_desc";

/**
 * POSTS SERVICE
 * ---------------------------------------------------------------------------
 * Create, read, edit and delete the unit of the feed. Sharing a workout or a
 * template is a *reference* this module owns the bookkeeping for, never a copy
 * (see `Post` for why), and the visibility rule lives in `PostVisibilityService`
 * rather than here so the feed can share it.
 *
 * ─── Layered validation: why a post is checked three times ──────────────────
 * A post is only meaningful if its `type` agrees with its reference *and* the
 * author owns what it references. That is checked in three places, on purpose:
 *
 *   1. **The DTO** catches a malformed request (no `workoutId` on a
 *      `WORKOUT_SHARE`) before a database round trip.
 *   2. **This service** catches the semantic cases a DTO cannot: the workout
 *      exists but belongs to someone else; the author has no coach profile but
 *      claims `COACH_CONTENT`; the text body is only whitespace. Sharing
 *      someone else's private workout is a privacy hole reachable from the
 *      social side, and "you may only share what is yours" is the rule that
 *      closes it.
 *   3. **A database CHECK** (in the migration) catches a row that got written
 *      anyway, so the invariant survives a future bug or a manual `INSERT`.
 *
 * ─── Deletes are soft, and always are ───────────────────────────────────────
 * A deleted post keeps its row so that a comment thread does not collapse into
 * "this content no longer exists" for everyone, and so a report against it can
 * still be resolved. The author's own view still shows the tombstone (rule (1)
 * of the visibility service) rather than pretending they never wrote it.
 *
 * ─── What is immutable ──────────────────────────────────────────────────────
 * `type`, `workoutId` and `workoutTemplateId`. Re-pointing a share at a different
 * workout would make the partial unique index (`one live share per author per
 * workout`) unenforceable and would let a post's card contradict its caption.
 * `UpdatePostDto` therefore does not accept them at all.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    @InjectRepository(Workout) private readonly workoutsRepo: Repository<Workout>,
    @InjectRepository(WorkoutTemplate) private readonly templatesRepo: Repository<WorkoutTemplate>,
    @InjectRepository(Coach) private readonly coachesRepo: Repository<Coach>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    private readonly visibility: PostVisibilityService,
    private readonly hydrator: PostHydrator,
    private readonly rateLimiter: SocialRateLimiter,
    private readonly dataSource: DataSource
  ) {}

  // ─── Writes ────────────────────────────────────────────────────────────────

  async create(authorId: string, dto: CreatePostDto): Promise<PostResponseDto> {
    // Quota is consumed after the cheap checks below and immediately before the
    // INSERT, so a request that is going to be rejected never costs the author
    // their own allowance.
    const type = dto.type ?? PostType.TEXT;
    const body = normalizeBody(dto.body);

    if (BODY_REQUIRED_TYPES.includes(type) && body === null) throw new BadRequestException("A body is required for this post type");

    const { workoutId, workoutTemplateId } = await this.resolveReferences(authorId, type, dto);
    await this.assertNoDuplicateShare(authorId, workoutId);

    this.rateLimiter.assertAllowed("post", await this.rateLimiter.consume("post", authorId));

    let post: Post;
    try {
      post = await this.postsRepo.save(
        this.postsRepo.create({
          authorId,
          type,
          body,
          privacy: dto.privacy ?? PostPrivacy.PUBLIC,
          workoutId,
          workoutTemplateId,
          likeCount: 0,
          commentCount: 0,
          isDeleted: false
        })
      );
    } catch (error) {
      // `uk_posts_author_workout` refuses a second live share of the same
      // workout; the read above is only here for a good error message.
      if (isUniqueViolation(error)) throw new ConflictException("You have already shared this workout");
      throw error;
    }

    return this.hydrator.toResponse(post, authorId);
  }

  /**
   * Edit a post. Author-only.
   *
   * Privacy can be tightened and loosened; the body can be replaced or cleared
   * for a share post. It cannot be *emptied* for a TEXT post, because a text post
   * with no body is not a post — the same rule the create path enforces, so the
   * invariant does not depend on which endpoint was used.
   */
  async update(authorId: string, postId: string, dto: UpdatePostDto): Promise<PostResponseDto> {
    const post = await this.requireOwnedPost(authorId, postId);
    const patch: Partial<Post> = {};

    if (dto.body !== undefined) {
      const body = normalizeBody(dto.body);
      if (body === null && BODY_REQUIRED_TYPES.includes(post.type)) throw new BadRequestException("A body is required for this post type");
      patch.body = body;
    }
    if (dto.privacy !== undefined) patch.privacy = dto.privacy;

    const saved = await this.postsRepo.save({ id: post.id, ...patch });
    return this.hydrator.toResponse({ ...post, ...saved }, authorId);
  }

  /** Soft-delete a post. Author-only. Idempotent. */
  async remove(authorId: string, postId: string): Promise<{ deleted: true }> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post || post.authorId !== authorId) throw new NotFoundException("Post not found");
    if (!post.isDeleted) {
      await this.postsRepo.update({ id: post.id }, { isDeleted: true, deletedAt: new Date(), deletedBy: authorId });
    }
    return { deleted: true };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * One post, or 404.
   *
   * The visibility context is resolved *before* the post is loaded only in the
   * sense that it is resolved from cached graph projections — the post row itself
   * is fetched by id, which is a primary-key lookup and reveals nothing through
   * its timing that the 404 does not.
   */
  async getOne(viewerId: string, postId: string): Promise<PostResponseDto> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException("Post not found");
    this.visibility.assertViewable(post, await this.visibility.contextFor(viewerId));
    return this.hydrator.toResponse(post, viewerId);
  }

  /**
   * A single author's posts, newest first, filtered by the visibility rule.
   *
   * Note the scope predicate is applied *before* the keyset seek and the limit,
   * not after. Filtering afterwards would return short pages and would advance a
   * cursor past rows the client never saw.
   */
  async listByAuthor(viewerId: string, authorId: string, query: PostQueryDto): Promise<PostPageResponseDto> {
    await this.requireLiveUser(authorId);
    const ctx = await this.visibility.contextFor(viewerId);
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, POST_LIST_CURSOR_STRATEGY) : null;

    const qb = this.postsRepo.createQueryBuilder("post").where("post.authorId = :authorId", { authorId }).andWhere("post.isDeleted = :isDeleted", { isDeleted: false });
    this.visibility.applyScope(qb, ctx);
    if (query.type) qb.andWhere("post.type = :type", { type: query.type });
    if (cursor) applyKeyset(qb, cursor.k);
    qb.orderBy("post.createdAt", "DESC")
      .addOrderBy("post.id", "DESC")
      .take(query.limit + 1);

    return this.hydrate(await qb.getMany(), viewerId, query.limit);
  }

  /**
   * Every post visible to the caller, newest first. The "public timeline".
   *
   * Not a substitute for the feed: it is not scoped to the follow graph, so it is
   * a plain visibility-filtered listing. It exists because "everything I am
   * allowed to see, newest first" is a real product need (a cold user's first
   * session) and because it is the simplest possible read against
   * `idx_posts_created` — the shape the feed query will later be measured against.
   */
  async listVisible(viewerId: string, query: PostFeedQueryDto): Promise<PostPageResponseDto> {
    const ctx = await this.visibility.contextFor(viewerId);
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, POST_LIST_CURSOR_STRATEGY) : null;

    const qb = this.postsRepo.createQueryBuilder("post").where("post.isDeleted = :isDeleted", { isDeleted: false });
    this.visibility.applyScope(qb, ctx);
    if (query.authorId) qb.andWhere("post.authorId = :authorId", { authorId: query.authorId });
    if (query.type) qb.andWhere("post.type = :type", { type: query.type });
    if (cursor) applyKeyset(qb, cursor.k);
    qb.orderBy("post.createdAt", "DESC")
      .addOrderBy("post.id", "DESC")
      .take(query.limit + 1);

    return this.hydrate(await qb.getMany(), viewerId, query.limit);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /**
   * Resolves and *authorises* the reference for the given type.
   *
   * Ownership is the whole point: `workoutId` must name a live workout whose
   * `userId` is the author. A share of someone else's workout would republish
   * content its owner never chose to publish, through a channel they cannot
   * audit — the one privacy hole the reference design would otherwise open.
   */
  private async resolveReferences(authorId: string, type: PostType, dto: CreatePostDto): Promise<{ workoutId: string | null; workoutTemplateId: string | null }> {
    if (type === PostType.WORKOUT_SHARE) {
      const workoutId = dto.workoutId;
      if (!workoutId) throw new BadRequestException("workoutId is required for a workout share");
      const workout = await this.workoutsRepo.findOne({ where: { id: workoutId, isDeleted: false } });
      if (!workout) throw new NotFoundException("Workout not found");
      if (workout.userId !== authorId) throw new ForbiddenException("You can only share your own workouts");
      return { workoutId, workoutTemplateId: null };
    }

    if (type === PostType.TEMPLATE_SHARE) {
      const templateId = dto.workoutTemplateId;
      if (!templateId) throw new BadRequestException("workoutTemplateId is required for a template share");
      const template = await this.templatesRepo.findOne({ where: { id: templateId, isDeleted: false } });
      if (!template) throw new NotFoundException("Workout template not found");
      if (template.userId !== authorId) throw new ForbiddenException("You can only share your own templates");
      return { workoutId: null, workoutTemplateId: templateId };
    }

    if (type === PostType.COACH_CONTENT) {
      // A coach-content post is a claim about who the author is. Without this
      // check the type is cosmetic: anyone could post "coach content".
      const coach = await this.coachesRepo.findOne({ where: { userId: authorId, isDeleted: false } });
      if (!coach) throw new ForbiddenException("Only coaches can publish coach content");
    }

    return { workoutId: null, workoutTemplateId: null };
  }

  /**
   * "One live share per workout per author" is a product rule, so it gets a
   * friendly 409 before the INSERT. The partial unique index remains the actual
   * guarantee; this is only so the common case is not a database error.
   */
  private async assertNoDuplicateShare(authorId: string, workoutId: string | null): Promise<void> {
    if (!workoutId) return;
    const existing = await this.postsRepo.findOne({ where: { authorId, workoutId, isDeleted: false }, select: { id: true } });
    if (existing) throw new ConflictException("You have already shared this workout");
  }

  private async requireOwnedPost(authorId: string, postId: string): Promise<Post> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    // 404 rather than 403 for someone else's post: a 403 confirms the id exists,
    // and the post id space is not something an outsider should be able to probe.
    if (!post || post.authorId !== authorId) throw new NotFoundException("Post not found");
    if (post.isDeleted) throw new NotFoundException("Post not found");
    return post;
  }

  private async requireLiveUser(userId: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId, isDeleted: false }, select: { id: true } });
    if (!user) throw new NotFoundException("User not found");
  }

  /**
   * Builds the page envelope from the ordered post rows, then hydrates the rows
   * that belong on the page.
   *
   * The envelope is computed from the **row** sequence and not from the hydrated
   * response list, deliberately. Hydration can legitimately drop a row (an author
   * that vanished between the two reads), and if `hasMore`/`nextCursor` were
   * derived from the responses the cursor would name a row the client never
   * received, silently skipping the posts in between. Deriving both from the same
   * `limit + 1` row window keeps "the cursor continues exactly what I was holding"
   * true even when a row is dropped.
   */
  private async hydrate(rows: Post[], viewerId: string, limit: number): Promise<PostPageResponseDto> {
    const page = toCursorPage(rows, limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: POST_LIST_CURSOR_STRATEGY, k: [row.createdAt.toISOString(), row.id] }));
    const data = await this.hydrator.toResponses(rows.slice(0, limit), viewerId);
    const meta: CursorPageMetaDto = { nextCursor: page.nextCursor, hasMore: page.hasMore };
    return { data, meta };
  }
}

/**
 * Keyset seek as a row-tuple comparison — see the same note in `FollowsService`.
 * `id` is the tiebreaker that makes the ordering total; without it two posts
 * sharing a `created_at` could straddle a page boundary and one would be lost.
 */
function applyKeyset(qb: { andWhere: (sql: string, params?: Record<string, unknown>) => unknown }, keys: string[]): void {
  if (keys.length !== 2) throw new BadRequestException("Malformed cursor");
  qb.andWhere("(post.createdAt, post.id) < (:cursorCreatedAt, :cursorId)", { cursorCreatedAt: new Date(keys[0]), cursorId: keys[1] });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Normalises a body to `string | null`.
 *
 * Whitespace-only becomes `null` rather than `""` so that "a body is required"
 * is one comparison everywhere, and so a post never ships an empty string that a
 * client has to special-case.
 */
function normalizeBody(body: string | null | undefined): string | null {
  const trimmed = body?.trim();
  return trimmed ? trimmed : null;
}
