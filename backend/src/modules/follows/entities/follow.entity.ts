import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";

/**
 * FOLLOW — one directed edge in the social graph (`followerId` → `followingId`).
 *
 * ── Unfollow is a soft delete, and that is what shapes the index ─────────────
 * Unfollowing sets `isDeleted` rather than deleting the row, so the graph keeps
 * the history of who followed whom and when (and so a re-follow can be
 * distinguished from a first follow). The cost of that choice is that
 * `uk_social_follow_pair` **must** be partial (`WHERE "isDeleted" = false`):
 * a plain unique index would make the second follow of the same person — the
 * legitimate one after an unfollow — collide with the soft-deleted row.
 *
 * With the predicate, "at most one live follow per ordered pair" is a database
 * guarantee, which is what makes duplicate-follow prevention correct under
 * concurrency rather than merely under a read-then-write race.
 *
 * ── Index shape ─────────────────────────────────────────────────────────────
 * The two composite indexes are the two directions the product asks for:
 *
 *   (follower_id, created_at)  — "who do I follow", and the feed's author scope
 *   (following_id, created_at) — "who follows me", and the follower counter
 *
 * Both lead with the column that is always equality-bound and trail with the
 * column the list is ordered/keyset-paginated by, so both the list read and its
 * cursor seek are index-only prefix scans.
 */
@Entity("social_follows")
@Index("idx_social_follows_follower_created", ["followerId", "createdAt"])
@Index("idx_social_follows_following_created", ["followingId", "createdAt"])
@Index("uk_social_follows_pair", ["followerId", "followingId"], { unique: true, where: '"isDeleted" = false' })
export class Follow extends AbstractEntity {
  @Column({ name: "follower_id", type: "uuid" })
  followerId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "follower_id" })
  follower: User;

  @Column({ name: "following_id", type: "uuid" })
  followingId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "following_id" })
  following: User;

  /** The instant the edge became live. Survives an unfollow/re-follow cycle. */
  @Column({ name: "followed_at", type: "timestamptz", default: () => "NOW()" })
  followedAt: Date;
}
