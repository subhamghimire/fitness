import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Post } from "src/modules/posts/entities";
import { User } from "src/modules/users/entities/user.entity";

/**
 * POST LIKE — one user's like on one post.
 *
 * ─── Unliking is a soft delete, and that is what shapes the index ────────────
 * Like and unlike are the same edge going live and dead, so unlike sets
 * `isDeleted` rather than removing the row. Two consequences follow, and both
 * are load-bearing:
 *
 *   1. `uk_post_likes_pair` **must** be partial (`WHERE "isDeleted" = false`).
 *      A plain unique index on `(post_id, user_id)` would make the second like —
 *      the completely ordinary one after an unlike — collide with the soft
 *      deleted row, and the user could never like that post again.
 *   2. With the predicate, "at most one live like per (user, post)" is a
 *      *database* guarantee. That is what makes duplicate-like prevention
 *      correct under concurrency: two simultaneous taps both pass the service's
 *      read-then-write check, exactly one INSERT survives, and the loser is
 *      translated into a 409 rather than surfacing as a 500. A read-then-write
 *      check on its own would let both rows through and inflate the counter.
 *
 * ─── Index shape ─────────────────────────────────────────────────────────────
 *   idx_post_likes_post_created — "the likers of this post, newest first", which
 *     is the liker list and the shape the feed's like-batch read uses.
 *   uk_post_likes_pair          — the duplicate guard, partial (above).
 *
 * There is deliberately **no** `(user_id, …)` index: nothing in the product
 * lists "posts this user liked". That is a decision about a query that does not
 * exist yet, and adding the index now would be paying write amplification for a
 * speculative read. When the liked-posts page is built, it earns its index then.
 *
 * `ON DELETE CASCADE` from `posts` is right: a post that is hard-deleted has no
 * likes to keep, whereas the soft-delete path leaves them in place so the counts
 * on a reported post remain inspectable.
 */
@Entity("post_likes")
@Index("idx_post_likes_post_created", ["postId", "createdAt"])
@Index("uk_post_likes_pair", ["postId", "userId"], { unique: true, where: '"isDeleted" = false' })
export class PostLike extends AbstractEntity {
  @Column({ name: "post_id", type: "uuid" })
  postId: string;

  @ManyToOne(() => Post, { onDelete: "CASCADE" })
  @JoinColumn({ name: "post_id" })
  post: Post;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;
}
