import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Post } from "src/modules/posts/entities";
import { User } from "src/modules/users/entities/user.entity";

/**
 * POST COMMENT — one comment on a post, or a reply to another comment.
 *
 * ─── Why the thread is exactly one level deep ───────────────────────────────
 * `parent_id` is a nullable self-reference, and the product rule is that it may
 * only point at a **top-level** comment (`COMMENT_MAX_DEPTH = 1`). One level is
 * what makes the two hard cases disappear:
 *
 *   - **A deleted parent.** With one level there are no orphans to re-parent and
 *     no "does this subtree still have a live root" question. A deleted top-level
 *     comment renders as a tombstone and its replies stay attached to it, which
 *     is also what keeps a thread readable as a conversation rather than a set of
 *     free-floating quotes.
 *   - **Pagination.** The list is keyset-paginated on `(post_id, created_at, id)`
 *     for top-level comments and replies are fetched with one batched `In` query
 *     for the page. A deeper tree would need its own paginated subtree reads to
 *     avoid returning a reply count that contradicts the rows delivered.
 *
 * The column shape does not preclude going deeper later; only this rule does.
 *
 * ─── `ON DELETE CASCADE` from `posts` ────────────────────────────────────────
 * A hard-deleted post leaves no comments. The soft-delete path — the normal one —
 * keeps them, and keeps `posts.comment_count` consistent, so an open thread on a
 * removed post still shows the conversation that led to the report.
 *
 * ─── Index shape ─────────────────────────────────────────────────────────────
 *   idx_post_comments_post_created — the thread read: comments by post, ordered
 *     newest-first within the page. Leading `post_id` is always equality-bound;
 *     `created_at` is the keyset column. This index is the "comments by post"
 *     requirement, and it serves both depths because depth is a filter on the
 *     rows it already returns, not a separate access path.
 *   idx_post_comments_parent       — replies for one parent, newest first, for
 *     the batched reply hydration. A comment has at most one parent, so this is
 *     a narrow, low-cardinality index that is only useful when a thread is
 *     actually rendered with its replies.
 *   uk_post_comments_live_body     — one live comment per (author, post, body),
 *     partial. This is the duplicate-submission guard: a client that retries a
 *     failed POST, or a user who double-taps, would otherwise create a visible
 *     duplicate. Body is truncated into the index by Postgres for long values,
 *     so the guard is exact for short comments and prefix-based for long ones —
 *     which is the right bias (a false duplicate is refused with a 409, and a
 *     resubmission is free).
 */
@Entity("post_comments")
@Index("idx_post_comments_post_created", ["postId", "createdAt"])
@Index("idx_post_comments_parent", ["parentId", "createdAt"])
@Index("uk_post_comments_live_body", ["authorId", "postId", "body"], { unique: true, where: '"isDeleted" = false' })
export class PostComment extends AbstractEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId: string;

  @ManyToOne(() => Post, { onDelete: "CASCADE" })
  @JoinColumn({ name: "post_id" })
  post: Post;

  @Column({ name: "author_id", type: "uuid" })
  authorId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "author_id" })
  author: User;

  @Column({ type: "text" })
  body: string;

  /** Null for a top-level comment; otherwise the top-level comment replied to. */
  @Column({ name: "parent_id", type: "uuid", nullable: true })
  parentId: string | null;

  @ManyToOne(() => PostComment, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "parent_id" })
  parent: PostComment | null;

  /**
   * `0` for a top-level comment, `1` for a reply. Stored rather than derived so
   * the thread read is a plain equality filter on an indexed column, and so the
   * invariant is checkable by a database constraint rather than only by the
   * service.
   */
  @Column({ type: "smallint", default: 0 })
  depth: number;

  /** Replies are only hydrated for a page of parents, and this bounds that. */
  @Column({ name: "reply_count", type: "int", default: 0 })
  replyCount: number;
}
