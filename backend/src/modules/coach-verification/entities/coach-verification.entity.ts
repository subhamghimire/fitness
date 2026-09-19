import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { CoachVerificationStatus } from "src/modules/coach/enums";
import { Column, Entity, Index, JoinColumn, OneToOne } from "typeorm";

@Entity({ name: "coach_verifications" })
export class CoachVerification extends AbstractEntity {
  @Index({ unique: true })
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @OneToOne(() => Coach, (coach) => coach.coachVerification, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ type: "enum", enum: CoachVerificationStatus, default: CoachVerificationStatus.PENDING })
  status: CoachVerificationStatus;

  @Column({ type: "timestamptz", name: "submitted_at", nullable: true })
  submittedAt: Date | null;

  @Column({ type: "timestamptz", name: "reviewed_at", nullable: true })
  reviewedAt: Date | null;

  @Column({ type: "uuid", name: "reviewed_by", nullable: true })
  reviewedBy: string | null;

  @Column({ type: "text", name: "decision_note", nullable: true })
  decisionNote: string | null;

  @Column({ type: "timestamptz", name: "expires_at", nullable: true })
  expiresAt: Date | null;
}
