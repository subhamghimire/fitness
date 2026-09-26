import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";
import { RelationshipStatus } from "../enums/coach-client.enum";

/**
 * Explicit coach <-> client relationship (Phase 6).
 *
 * History preservation: a relationship is never overwritten once it reaches a
 * terminal state. `startedAt` records when the client accepted and the plan
 * began; `endedAt` records when the relationship was ended/blocked. Re-inviting
 * the same client always produces a new row — the partial unique index below
 * guarantees only ONE live (pending/active/paused) relationship per pair at any
 * point in time, while past rows remain untouched.
 */
@Entity({ name: "coach_client_relationships" })
@Index("uq_coach_client_live_relationship", ["coachId", "clientId"], {
  unique: true,
  where: `"status" IN ('pending', 'active', 'paused')`
})
@Index("idx_ccr_coach_live_started", ["coachId", "status", "startedAt", "id"], {
  where: `"isDeleted" = false`
})
@Index("idx_ccr_coach_pending_created", ["coachId", "createdAt", "id"], {
  where: `"isDeleted" = false AND "status" = 'pending'`
})
export class CoachClientRelationship extends AbstractEntity {
  @Index("idx_coach_client_relationships_coach")
  @Index("idx_coach_client_relationships_coach_status", ["coachId", "status"])
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Index("idx_coach_client_relationships_client")
  @Column({ name: "client_id", type: "uuid" })
  clientId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client: User;

  @Column({
    name: "status",
    type: "enum",
    enum: RelationshipStatus,
    default: RelationshipStatus.PENDING
  })
  status: RelationshipStatus;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "ended_at", type: "timestamptz", nullable: true })
  endedAt: Date | null;
}
