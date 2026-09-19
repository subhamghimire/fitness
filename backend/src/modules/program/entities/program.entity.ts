import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Entity, Index, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { ProgramDay } from "./program-day.entity";

/**
 * PROGRAM — a multi-week / multi-day coaching plan owned by a coach.
 *
 * Distinct from a WorkoutTemplate (= one workout): a Program is a structured
 * schedule composed of ProgramDays, each of which holds ProgramWorkouts (links
 * to a WorkoutTemplate). Programs are templates owned by the coach; the actual
 * delivery to a client happens through a ProgramAssignment (preserved
 * historically, never overwritten).
 */
@Entity({ name: "programs" })
export class Program extends AbstractEntity {
  @Index("idx_programs_coach")
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @OneToMany(() => ProgramDay, (day) => day.program, {
    cascade: true,
    onDelete: "CASCADE"
  })
  days: ProgramDay[];
}
