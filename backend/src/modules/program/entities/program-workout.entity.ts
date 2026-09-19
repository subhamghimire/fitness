import { AbstractEntity } from "src/entities";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";
import { ProgramDay } from "./program-day.entity";
import { WorkoutTemplate } from "src/modules/workout/entities/workout-template.entity";

/**
 * PROGRAM WORKOUT — a single workout slot inside a ProgramDay.
 *
 * References a WorkoutTemplate (one workout definition) so clients can view the
 * full planned exercise/set structure. `name` is a denormalized snapshot of the
 * template name at scheduling time.
 */
@Entity({ name: "program_workouts" })
@Index("idx_program_workouts_program_day", ["programDayId", "orderIndex"])
export class ProgramWorkout extends AbstractEntity {
  @Column({ name: "program_day_id", type: "uuid" })
  programDayId: string;

  @ManyToOne(() => ProgramDay, (day) => day.workouts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "program_day_id" })
  day: ProgramDay;

  @Index("idx_program_workouts_template")
  @Column({ name: "workout_template_id", type: "uuid" })
  workoutTemplateId: string;

  @ManyToOne(() => WorkoutTemplate, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "workout_template_id" })
  workoutTemplate: WorkoutTemplate;

  @Column({ type: "varchar", length: 200, nullable: true })
  name: string | null;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "text", nullable: true })
  notes: string | null;
}
