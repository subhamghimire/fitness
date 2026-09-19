import { AbstractEntity } from "src/entities";
import { Entity, Index, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { Program } from "./program.entity";
import { ProgramWorkout } from "./program-workout.entity";

/**
 * PROGRAM DAY — one scheduled day inside a Program plan.
 *
 * `weekNumber` + `dayNumber` encode the slot in the plan
 * (1-based week, 1-based day within the week). The absolute calendar date of a
 * day is derived from the assignment's start date:
 * date = assignment.startDate + ((weekNumber - 1) * 7) + (dayNumber - 1) days.
 */
@Entity({ name: "program_days" })
@Index("idx_program_days_program", ["programId", "weekNumber", "dayNumber", "orderIndex"])
export class ProgramDay extends AbstractEntity {
  @Column({ name: "program_id", type: "uuid" })
  programId: string;

  @ManyToOne(() => Program, (program) => program.days, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_id" })
  program: Program;

  @Column({ name: "week_number", type: "int", default: 1 })
  weekNumber: number;

  @Column({ name: "day_number", type: "int", default: 1 })
  dayNumber: number;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "varchar", length: 200, nullable: true })
  name: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @OneToMany(() => ProgramWorkout, (w) => w.day, {
    cascade: true,
    onDelete: "CASCADE"
  })
  workouts: ProgramWorkout[];
}
