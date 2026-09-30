import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { BlockReason } from "../enums";

/**
 * USER BLOCK — the foundation of the abuse model, and it is deliberately
 * *directional in storage but symmetric in effect*.
 *
 * A block is one row (`blocker` → `blocked`). Every read path treats the
 * relationship as mutual anyway — a blocker's posts disappear from the
 * blocker's feed and the blocked user's feed alike — because a one-way
 * "you can't see me" is trivially circumvented by logging in on a second
 * device. Storing one direction keeps the unique index honest and the write
 * path single-row; the *symmetry* lives in the read queries, which exclude
 * both `blocked_id = :viewer` and `blocker_id = :viewer`.
 *
 * Blocking is also destructive by design: `BlocksService.block` soft-deletes the
 * follow edges in both directions in the same transaction. Leaving the edges in
 * place would let a blocked pair keep each other's follower counts and would
 * keep the blocked user's posts in the blocker's cached follow graph.
 *
 * Indexes mirror the two read directions: "who did I block" (my block list) and
 * "who blocked me" (the read-side exclusion that has to be fast on every feed
 * read). `uk_social_blocks_pair` is partial for the same reason as follows —
 * unblocking soft-deletes the row, and blocking again must be allowed.
 */
@Entity("social_blocks")
@Index("idx_social_blocks_blocker", ["blockerId", "createdAt"])
@Index("idx_social_blocks_blocked", ["blockedId", "createdAt"])
@Index("uk_social_blocks_pair", ["blockerId", "blockedId"], { unique: true, where: '"isDeleted" = false' })
export class UserBlock extends AbstractEntity {
  @Column({ name: "blocker_id", type: "uuid" })
  blockerId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "blocker_id" })
  blocker: User;

  @Column({ name: "blocked_id", type: "uuid" })
  blockedId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "blocked_id" })
  blocked: User;

  /**
   * Optional, and deliberately coarse: the reason is for the blocker's own
   * bookkeeping, not for enforcement. No enforcement or moderation decision may
   * depend on it.
   */
  @Column({ type: "varchar", length: 24, nullable: true })
  reason: BlockReason | null;

  /**
   * Optional private note ("kept messaging me after I said no"). Visible only to
   * the blocker through `GET /social/blocks`, and never rendered to the blocked
   * user — a block that explains itself is a harassment vector.
   */
  @Column({ type: "varchar", length: 200, nullable: true })
  note: string | null;
}
