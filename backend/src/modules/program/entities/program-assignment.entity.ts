import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";
import { Program } from "./program.entity";
import { ProgramAssignmentStatus } from "../enums/program.enum";

/**
 * PROGRAM ASSIGNMENT — a specific Program delivered to a specific client by a
 * specific coach.
 *
 * History preservation: once COMPLETED / CANCELLED an assignment is never
 * overwritten. Re-assigning the same program to the same client creates a new
 * row. The partial unique index guarantees at most one LIVE assignment
 * (upcoming/active) per (program, client) pair.
 *
 * `startDate` is the first calendar day of the plan; each ProgramDay's calendar
 * date is derived from it (see ProgramDay).
 */
@Entity({ name: "program_assignments" })
@Index("uq_program_assignments_live", ["programId", "clientId"], {
  unique: true,
  where: `"is_active" = true`
})
export class ProgramAssignment extends AbstractEntity {
  @Index("idx_program_assignments_program")
  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @ManyToOne(() => Program, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_id" })
  program: Program;

  @Index("idx_program_assignments_coach")
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Index("idx_program_assignments_client")
  @Column({ name: "client_id", type: "uuid" })
  clientId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client: User;

  @Column({ name: "start_date", type: "timestamptz" })
  startDate: Date;

  @Column({ name: "end_date", type: "timestamptz", nullable: true })
  endDate: Date | null;

  @Column({
    name: "status",
    type: "enum",
    enum: ProgramAssignmentStatus,
    default: ProgramAssignmentStatus.UPCOMING
  })
  status: ProgramAssignmentStatus;

  /** Mirrors `status`: true while the assignment is live, false once terminal. */
  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  /** When the assignment was actually started / ended by a coach action. */
  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null;

  @Column({ name: "ended_at", type: "timestamptz", nullable: true })
  endedAt: Date | null;
}
