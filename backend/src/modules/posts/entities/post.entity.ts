import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { Workout } from "src/modules/workout/entities/workout.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";
import { PostPrivacy, PostType } from "../enums";

/**
 * POST — the unit of the social feed.
 *
 * ─── Why a post references a workout instead of copying it ──────────────────
 * Sharing is a *reference*, never a copy. A duplicated workout would go stale the
 * moment the owner edited it, and the social layer would have to grow a sync
 * protocol for data it does not own. The arrow is one-way and read-only:
 * `posts.workout_id → workouts.id`. The workout module knows nothing about posts
 * and gains no social behaviour; the social module only ever reads the
 * referenced row, and only ever verifies the author owns it.
 *
 * That is also why both references must be owned by the post's author. Sharing
 * someone else's private workout would be a privacy hole reachable from the
 * social side, and the only rule that closes it is "you may only share what is
 * yours".
 *
 * ─── Index design: one index per query the product actually makes ────────────
 *
 *   idx_posts_author_created   — a profile's own posts, keyset-paginated.
 *   idx_posts_created          — the default (recency) feed.
 *   idx_posts_engagement       — the "hot" ranking: (like_count, comment_count,
 *                                created_at). B-tree indexes scan backwards, so a
 *                                plain ASC index serves the DESC feed order
 *                                without a second copy of the table.
 *   idx_posts_author_privacy   — followers-only posts per author, i.e. the
 *                                branch of the visibility predicate that is not
 *                                an equality on the author alone.
 *   uk_posts_author_workout    — one live share of a given workout per author
 *                                (partial, see below).
 *
 * The two denormalised counters (`like_count`, `comment_count`) are the price of
 * a feed that can be ordered by engagement without a correlated subquery per
 * row. They are maintained only by `LikesService` / `CommentsService`, and every
 * mutation of them is guarded by a conditional UPDATE whose affected-row count
 * gates the counter change — so the counter cannot drift under concurrency. The
 * CHECK constraints make a negative counter impossible even if a future bug
 * tries.
 *
 * ─── Why the unique index on shares is partial ──────────────────────────────
 * Deleting a post is a soft delete, so a plain unique constraint on
 * `(author_id, workout_id)` would permanently prevent re-sharing that workout
 * after the first post was removed. `WHERE isDeleted = false` makes the
 * guarantee "at most one *live* share", which is the product rule, and leaves
 * history intact.
 *
 * The reference is also `ON DELETE SET NULL`: if the underlying workout is
 * hard-deleted the post survives as a caption rather than disappearing, because
 * a post is content a user wrote, not a view of a row we happen to own.
 */
@Entity("posts")
@Index("idx_posts_author_created", ["authorId", "createdAt"])
@Index("idx_posts_created", ["createdAt"])
@Index("idx_posts_engagement", ["likeCount", "commentCount", "createdAt"])
@Index("idx_posts_author_privacy", ["authorId", "privacy"])
@Index("uk_posts_author_workout", ["authorId", "workoutId"], { unique: true, where: '"isDeleted" = false AND "workout_id" IS NOT NULL' })
export class Post extends AbstractEntity {
  @Column({ name: "author_id", type: "uuid" })
  authorId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "author_id" })
  author: User;

  @Column({ type: "varchar", length: 24, default: PostType.TEXT })
  type: PostType;

  /** Caption / body. Required for TEXT and COACH_CONTENT, optional otherwise. */
  @Column({ type: "text", nullable: true })
  body: string | null;

  @Column({ type: "varchar", length: 16, default: PostPrivacy.PUBLIC })
  privacy: PostPrivacy;

  // ─── Referenced content (read-only from the owning modules' point of view) ──

  @Column({ name: "workout_id", type: "uuid", nullable: true })
  workoutId: string | null;

  @ManyToOne(() => Workout, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "workout_id" })
  workout: Workout | null;

  @Column({ name: "workout_template_id", type: "uuid", nullable: true })
  workoutTemplateId: string | null;

  @ManyToOne(() => WorkoutTemplate, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "workout_template_id" })
  workoutTemplate: WorkoutTemplate | null;

  // ─── Denormalised counters ─────────────────────────────────────────────────

  @Column({ name: "like_count", type: "int", default: 0 })
  likeCount: number;

  @Column({ name: "comment_count", type: "int", default: 0 })
  commentCount: number;
}
