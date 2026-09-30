import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, SelectQueryBuilder } from "typeorm";
import { CursorPageMetaDto } from "src/common/dto";
import { buildIdempotencyKey, DomainAggregateType, DomainEventPublisher, DomainEventType, excerpt, CommentAddedEvent } from "src/common/events";
import { decodeSocialCursor, encodeSocialCursor, SOCIAL_CURSOR_VERSION, toCursorPage } from "src/common/social";
import { SocialRateLimiter, SocialUserLoader, SocialUserPresenter } from "src/shared/social";
import { Post } from "src/modules/posts/entities";
import { PostEngagementService } from "src/modules/posts/post-engagement.service";
import { PostVisibilityService } from "src/modules/posts/post-visibility.service";
import { COMMENT_SORTS, CommentPageResponseDto, CommentQueryDto, CommentResponseDto, CreateCommentDto, UpdateCommentDto } from "./dto";
import { PostComment } from "./entities";

/** Cursor strategy for a flat, strictly chronological comment list. */
const COMMENT_FLAT_CURSOR_STRATEGY = "comment_created_desc";
/** Cursor strategy for the top-level list. Replies ride along and are not paginated. */
const COMMENT_TOP_CURSOR_STRATEGY = "comment_top_created_desc";

/**
 * The columns the read model actually needs.
 *
 * Narrower than `PostComment` on purpose. `AbstractEntity` extends TypeORM's
 * `BaseEntity`, so a full entity carries `save`/`remove`/`hasId` — and a
 * partially-updated row (`{ ...comment, body }`) is structurally a comment but no
 * longer an entity instance. Typing the assemblers against this `Pick` means the
 * read path never depends on the entity's *behaviour* surface, and a
 * partially-populated row is a first-class input rather than something that needs
 * a cast to launder past the compiler.
 */
type CommentRow = Pick<PostComment, "id" | "postId" | "authorId" | "body" | "parentId" | "depth" | "replyCount" | "isDeleted" | "createdAt" | "updatedAt" | "author">;

/**
 * COMMENTS SERVICE
 * ---------------------------------------------------------------------------
 * Owns `post_comments`, the one-level thread, and the two counters a thread
 * implies: `posts.comment_count` (total live comments) and
 * `post_comments.reply_count` (live replies to one comment).
 *
 * ─── Three rules that are not obvious ───────────────────────────────────────
 *
 * **1. A comment inherits its post's visibility, always.**
 * A comment is not an independent object with its own audience; it is a remark
 * on content the reader may or may not be allowed to see. Every read therefore
 * resolves the parent post's visibility *first* and then filters. There is
 * deliberately no separate visibility column on the comment, because a second
 * one is a second rule to keep in sync and the two could disagree — and when they
 * disagree, the comment wins by accident, because it is the thing being fetched.
 *
 * **2. Deleted comments are tombstones, not holes.**
 * A soft-deleted comment still occupies its position in the thread, with its
 * body withheld and its replies intact. The alternatives are both worse:
 * removing the row orphans its replies into a set of context-free quotes, and
 * hiding the row in the query makes a thread's page collapse and shifts every
 * keyset boundary under the client. With a tombstone the ordering, the page
 * boundaries and the "was there something rude here" trail are all preserved.
 * The single exception is a *deleted author's account*, where the body is
 * withheld and no tombstone marker is added — see `toResponse`.
 *
 * **3. Counters move in the caller's transaction, gated on what actually changed.**
 * Identical discipline to `LikesService`, and for the same reason: the counter
 * and the fact must commit together, and a decrement must only happen on the
 * call that actually removed a live comment. A retried delete must not drive
 * `comment_count` below the truth.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(PostComment) private readonly commentsRepo: Repository<PostComment>,
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    private readonly visibility: PostVisibilityService,
    private readonly engagement: PostEngagementService,
    private readonly userLoader: SocialUserLoader,
    private readonly userPresenter: SocialUserPresenter,
    private readonly rateLimiter: SocialRateLimiter,
    private readonly eventPublisher: DomainEventPublisher,
    private readonly dataSource: DataSource
  ) {}

  // ─── Writes ────────────────────────────────────────────────────────────────

  /**
   * Create a comment or a reply.
   *
   * Order of operations matters and is the same on every write path: resolve and
   * authorise the post, resolve and authorise the parent (if any), *then*
   * consume quota, *then* write. A request that will be rejected never costs the
   * author their allowance, which is what stops an abusive client from locking a
   * legitimate user out of commenting by spamming invalid requests.
   */
  async create(userId: string, postId: string, dto: CreateCommentDto): Promise<CommentResponseDto> {
    const post = await this.requireViewablePost(userId, postId);
    const parent = dto.parentId ? await this.requireReplyableParent(post, dto.parentId, userId) : null;

    this.rateLimiter.assertAllowed("comment", await this.rateLimiter.consume("comment", userId));

    const body = normalizeBody(dto.body);
    if (!body) throw new BadRequestException("Comment body cannot be empty");

    let comment: PostComment;
    try {
      comment = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(PostComment);
        const saved = await repo.save(
          repo.create({
            postId,
            authorId: userId,
            body,
            parentId: parent?.id ?? null,
            depth: parent ? 1 : 0,
            replyCount: 0,
            isDeleted: false
          })
        );
        // A reply bumps the parent's `reply_count`; a top-level comment bumps the
        // post's `comment_count`. Both in the same transaction as the insert, so
        // a comment is never visible without its count.
        if (parent)
          await manager
            .createQueryBuilder()
            .update(PostComment)
            .set({ replyCount: () => `GREATEST(0, "reply_count" + 1)` })
            .where("id = :parentId", { parentId: parent.id })
            .execute();
        else await this.engagement.adjustComments(manager, postId, 1);
        return saved;
      });
    } catch (error) {
      // `uk_post_comments_live_body` refuses an identical resubmission of the
      // same body on the same post. A client retrying a failed POST gets a 409
      // it can treat as "already posted" rather than a visible duplicate thread.
      if (isUniqueViolation(error)) throw new ConflictException("You have already posted this comment");
      throw error;
    }

    await this.announceComment(comment, parent ? parent.authorId : post.authorId);
    return this.toResponse(comment, userId);
  }

  /** Edit a comment. Author-only, body only. */
  async update(userId: string, commentId: string, dto: UpdateCommentDto): Promise<CommentResponseDto> {
    const comment = await this.requireOwnedComment(userId, commentId);
    if (dto.body === undefined) return this.toResponse(comment, userId);

    const body = normalizeBody(dto.body);
    if (!body) throw new BadRequestException("Comment body cannot be empty");
    // The duplicate guard covers edits too: the unique index is on the *live*
    // body, so rewriting a comment into an identical sibling of the same post
    // is refused rather than allowed.
    try {
      await this.commentsRepo.update({ id: comment.id }, { body });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("You have already posted this comment");
      throw error;
    }
    return this.toResponse({ ...comment, body }, userId);
  }

  /**
   * Soft-delete a comment. Author-only, idempotent.
   *
   * Replies are **not** deleted with their parent. A thread that loses all of its
   * context because one person left is worse than a tombstone with replies under
   * it, and keeping them costs nothing: they are still subject to the post's
   * visibility, and the parent's tombstone already says the conversation is over.
   */
  async remove(userId: string, commentId: string): Promise<{ deleted: true }> {
    const comment = await this.commentsRepo.findOne({ where: { id: commentId } });
    if (!comment || comment.authorId !== userId) throw new NotFoundException("Comment not found");
    if (comment.isDeleted) return { deleted: true };
    await this.requireViewablePost(userId, comment.postId);

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(PostComment)
        .set({ isDeleted: true, deletedAt: new Date(), deletedBy: userId })
        .where("id = :id", { id: comment.id })
        .andWhere('"isDeleted" = false')
        .execute();

      // Gate the decrement on the row that actually changed, so a retry is free.
      if ((result.affected ?? 0) === 0) return;
      if (comment.depth === 1 && comment.parentId) {
        await manager
          .createQueryBuilder()
          .update(PostComment)
          .set({ replyCount: () => `GREATEST(0, "reply_count" - 1)` })
          .where("id = :parentId", { parentId: comment.parentId })
          .execute();
      } else {
        await this.engagement.adjustComments(manager, comment.postId, -1);
      }
    });

    return { deleted: true };
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /**
   * A post's comments.
   *
   * Two orderings, two cursors, and they are deliberately *not* interchangeable:
   *
   *   - `recent` — one flat chronological list of every comment (top-level and
   *     replies interleaved, oldest first). The cursor is `(created_at, id)`,
   *     which is exactly `idx_post_comments_post_created`. This is the cheapest
   *     read and the one a client should use by default.
   *   - `top` — top-level comments oldest-first, each with its replies nested
   *     and ordered oldest-first (a conversation reads forwards). The cursor is
   *     over *top-level rows only*, and replies ride along with the page. Paging
   *     over parents while replies change underneath is correct here precisely
   *     because a reply never creates or removes a parent, so a page boundary
   *     can never shift because of reply activity.
   *
   * A cursor minted for one ordering is rejected by the other (the strategy name
   * is inside the cursor), so a client that switches `sort` mid-pagination gets a
   * 400 telling it to restart rather than a scrambled thread.
   */
  async list(userId: string, postId: string, query: CommentQueryDto): Promise<CommentPageResponseDto> {
    await this.requireViewablePost(userId, postId);
    // The DTO's `@IsIn` already refuses an unknown `sort` at the edge, but the
    // service is callable from tests and (later) other modules, so an
    // unrecognised value degrades to the default ordering rather than falling
    // into the "top" branch by accident.
    const isTop = query.sort === "top" && COMMENT_SORTS.includes(query.sort);
    const strategy = isTop ? COMMENT_TOP_CURSOR_STRATEGY : COMMENT_FLAT_CURSOR_STRATEGY;
    const cursor = query.cursor ? decodeSocialCursor(query.cursor, strategy) : null;

    // An explicit `parentId` means "the replies to this one comment" and is a
    // genuinely different read from a thread, so it is paginated flat and ignores
    // `sort`. It is also the only way a client can page a single conversation.
    if (query.parentId) return this.listReplies(userId, postId, query.parentId, query.limit, cursor, strategy);

    const qb = this.commentsRepo
      .createQueryBuilder("comment")
      .where("comment.postId = :postId", { postId })
      .andWhere('"comment"."isDeleted" = false OR "comment"."authorId" = :viewerId', { viewerId: userId })
      .andWhere(isTop ? "comment.depth = :depth" : "1 = 1", { depth: 0 });

    if (cursor) applyKeysetAsc(qb, cursor.k);
    // Oldest first: a thread reads forwards, so both the flat (`recent`) and
    // the parent (`top`) lists walk ASC. Replies are ASC too, which keeps the
    // keyset direction (`>`) the same on every comment read.
    qb.orderBy("comment.createdAt", "ASC")
      .addOrderBy("comment.id", "ASC")
      .take(query.limit + 1);

    const rows = await qb.getMany();
    if (!isTop) {
      const page = toCursorPage(rows, query.limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: strategy, k: [row.createdAt.toISOString(), row.id] }));
      return { data: (await this.toResponses(rows.slice(0, query.limit), userId)).map((comment) => ({ ...comment, replies: [] })), meta: envelope(page) };
    }

    const parents = rows.slice(0, query.limit);
    const page = toCursorPage(rows, query.limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: strategy, k: [row.createdAt.toISOString(), row.id] }));
    const repliesByParent = await this.loadReplies(
      parents.map((row) => row.id),
      userId
    );
    const mapped = await this.toResponses(parents, userId);
    return { data: mapped.map((comment) => ({ ...comment, replies: repliesByParent.get(comment.id) ?? [] })), meta: envelope(page) };
  }

  /** One comment, or 404. Same tombstone rules as the list. */
  async getOne(userId: string, commentId: string): Promise<CommentResponseDto> {
    const comment = await this.commentsRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException("Comment not found");
    await this.requireViewablePost(userId, comment.postId);
    if (comment.isDeleted && comment.authorId !== userId) throw new NotFoundException("Comment not found");
    return this.toResponse(comment, userId);
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** Replies to one top-level comment, oldest-first, paginated. */
  private async listReplies(
    userId: string,
    postId: string,
    parentId: string,
    limit: number,
    cursor: ReturnType<typeof decodeSocialCursor> | null,
    strategy: string
  ): Promise<CommentPageResponseDto> {
    const parent = await this.commentsRepo.findOne({ where: { id: parentId, postId }, select: { id: true, depth: true } });
    // The parent must exist on this post and be top-level: a `parentId` that
    // names a reply, or a comment on a different post, is a 404 rather than a
    // silently empty page.
    if (!parent || parent.depth !== 0) throw new NotFoundException("Comment not found");

    const qb = this.commentsRepo
      .createQueryBuilder("comment")
      .where("comment.parentId = :parentId", { parentId })
      .andWhere('"comment"."isDeleted" = false OR "comment"."authorId" = :viewerId', { viewerId: userId });
    if (cursor) applyKeysetAsc(qb, cursor.k);
    // Forward order: a conversation reads oldest → newest. The keyset seeks
    // forward (`>`) because the ordering is ASC — the same row-tuple form as
    // everywhere else, but in the direction the client is walking.
    qb.orderBy("comment.createdAt", "ASC")
      .addOrderBy("comment.id", "ASC")
      .take(limit + 1);

    const rows = await qb.getMany();
    const page = toCursorPage(rows, limit, (row) => encodeSocialCursor({ v: SOCIAL_CURSOR_VERSION, s: strategy, k: [row.createdAt.toISOString(), row.id] }));
    return { data: (await this.toResponses(rows.slice(0, limit), userId)).map((comment) => ({ ...comment, replies: [] })), meta: envelope(page) };
  }

  /**
   * Batched reply hydration for a page of parents — one query for the whole page,
   * keyed by parent.
   *
   * A per-parent lookup would be the classic N+1 on the most-likely-to-be-long
   * list in the product. Bounded by the page limit, so the `In` list is at most
   * as long as the page the client is holding.
   */
  private async loadReplies(parentIds: string[], viewerId: string): Promise<Map<string, CommentResponseDto[]>> {
    if (parentIds.length === 0) return new Map();
    const rows = await this.commentsRepo
      .createQueryBuilder("comment")
      .where("comment.parentId IN (:...parentIds)", { parentIds })
      .andWhere('"comment"."isDeleted" = false OR "comment"."authorId" = :viewerId', { viewerId })
      .orderBy("comment.createdAt", "ASC")
      .addOrderBy("comment.id", "ASC")
      .getMany();

    const byParent = new Map<string, CommentResponseDto[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const bucket = byParent.get(row.parentId) ?? [];
      bucket.push(await this.toResponse(row, viewerId));
      byParent.set(row.parentId, bucket);
    }
    return byParent;
  }

  /**
   * The parent must be a *top-level* comment on the *same post*, and must be
   * live. Enforcing the first two here is what keeps the thread one level deep;
   * enforcing the third is what keeps a reply from being attached to something
   * the reader can no longer see.
   */
  private async requireReplyableParent(post: Post, parentId: string, userId: string): Promise<PostComment> {
    const parent = await this.commentsRepo.findOne({ where: { id: parentId } });
    if (!parent || parent.postId !== post.id || parent.depth !== 0) throw new NotFoundException("Comment not found");
    if (parent.isDeleted && parent.authorId !== userId) throw new NotFoundException("Comment not found");
    return parent;
  }

  private async requireViewablePost(userId: string, postId: string): Promise<Post> {
    const post = await this.postsRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException("Post not found");
    this.visibility.assertViewable(post, await this.visibility.contextFor(userId));
    return post;
  }

  /** 404 (not 403) for someone else's comment — see the note in `PostsService`. */
  private async requireOwnedComment(userId: string, commentId: string): Promise<PostComment> {
    const comment = await this.commentsRepo.findOne({ where: { id: commentId } });
    if (!comment || comment.authorId !== userId || comment.isDeleted) throw new NotFoundException("Comment not found");
    await this.requireViewablePost(userId, comment.postId);
    return comment;
  }

  private async toResponses(rows: CommentRow[], viewerId: string): Promise<CommentResponseDto[]> {
    if (rows.length === 0) return [];
    const authors = await this.userLoader.loadByIds(rows.map((row) => row.authorId));
    return rows.flatMap((row) => {
      const author = authors.get(row.authorId);
      if (!author) return [];
      return [this.assemble(row, author, viewerId)];
    });
  }

  private async toResponse(row: CommentRow, viewerId: string): Promise<CommentResponseDto> {
    const authors = await this.userLoader.loadByIds([row.authorId]);
    return this.assemble(row, authors.get(row.authorId) ?? this.fallbackAuthor(row), viewerId);
  }

  /**
   * The one place a comment becomes an API shape.
   *
   * Two things happen here that are easy to get wrong per-module and are
   * therefore done once:
   *
   *   - **Tombstoning.** A soft-deleted comment is returned with `isDeleted:
   *     true` and `body: ""` — never the original text, and never a
   *     "this comment was removed" string *with the author's name attached as if
   *     they had said it*. The author summary is still present because a
   *     conversation has to attribute its turns; the body is what is withheld.
   *   - **Viewer state.** `canModify` is derived from `isAuthor` rather than
   *     being a separate check, so a client cannot be told "you may edit this"
   *     and then be refused.
   */
  private assemble(row: CommentRow, author: CommentResponseDto["author"], viewerId: string): CommentResponseDto {
    const isAuthor = row.authorId === viewerId;
    return {
      id: row.id,
      postId: row.postId,
      author,
      body: row.isDeleted ? "" : row.body,
      parentId: row.parentId,
      depth: row.depth,
      replyCount: row.replyCount,
      viewer: { isAuthor, canModify: isAuthor && !row.isDeleted },
      isDeleted: row.isDeleted,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private fallbackAuthor(row: CommentRow): CommentResponseDto["author"] {
    return this.userPresenter.toSummary({
      id: row.authorId,
      name: row.author?.name ?? "Unknown",
      avatar: row.author?.avatar ?? null,
      googlePhotoUrl: row.author?.googlePhotoUrl ?? null
    });
  }

  /**
   * Announces a new comment to the post's author, or to the parent comment's
   * author for a reply.
   *
   * Published *after* the commit through `DomainEventPublisher.publish`, never
   * inside the transaction: a notification concern must not be able to fail a
   * comment, and the audience is resolved later by the notification pipeline
   * rather than here.
   *
   * The idempotency key is the comment id. Unlike a follow edge, a comment is a
   * new row every time — a resubmission that collides on
   * `uk_post_comments_live_body` never reaches here — so the comment id is a
   * genuinely unique natural key and cannot collapse two distinct comments.
   */
  /**
   * Announces a new comment to whoever should hear about it.
   *
   * A reply notifies the parent commenter; a top-level comment notifies the
   * post's author. The recipient is passed in rather than derived from a
   * relation, because the post and the parent are both already in hand and
   * lazily loading a relation here would put a query on the response path for a
   * value the caller already knows.
   *
   * Nobody is notified about their own comment — the author commenting on their
   * own post is a legitimate thing to do and must not ping them.
   */
  private async announceComment(comment: CommentRow, recipientId: string): Promise<void> {
    if (recipientId === comment.authorId) return;

    const event: CommentAddedEvent = {
      type: DomainEventType.COMMENT_ADDED,
      occurredAt: new Date(),
      idempotencyKey: buildIdempotencyKey(DomainEventType.COMMENT_ADDED, comment.id),
      actorId: comment.authorId,
      audience: { kind: "users", userIds: [recipientId], excludeActor: true },
      aggregate: { type: DomainAggregateType.COMMENT, id: comment.id },
      payload: {
        commentId: comment.id,
        authorName: comment.author?.name ?? null,
        excerpt: excerpt(comment.body),
        targetType: "post",
        targetId: comment.postId
      }
    };
    await this.eventPublisher.publish(event);
  }
}

/** Postgres 23505 — the partial unique index refused the row. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * Keyset seek as a row-tuple comparison, oldest → newest. The `id` tiebreaker
 * makes the ordering total: without it two comments sharing a `created_at`
 * could straddle a page boundary and one would be skipped forever. See the
 * same note in `FollowsService`.
 */
function applyKeysetAsc(qb: SelectQueryBuilder<PostComment>, keys: string[]): void {
  if (keys.length !== 2) throw new BadRequestException("Malformed cursor");
  qb.andWhere("(comment.createdAt, comment.id) > (:cursorCreatedAt, :cursorId)", { cursorCreatedAt: new Date(keys[0]), cursorId: keys[1] });
}

function envelope(page: { nextCursor: string | null; hasMore: boolean }): CursorPageMetaDto {
  return { nextCursor: page.nextCursor, hasMore: page.hasMore };
}

/** Whitespace-only collapses to `""`, which the create/update paths refuse. */
function normalizeBody(body: string): string {
  return body.trim();
}
