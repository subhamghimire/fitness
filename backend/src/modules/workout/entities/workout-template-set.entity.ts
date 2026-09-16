import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { WorkoutTemplateExercise } from "./workout-template-exercise.entity";

/**
 * SET — an individual planned set inside a workout template exercise.
 */
@Entity("workout_template_sets")
export class WorkoutTemplateSet extends AbstractEntity {
  @Index()
  @Column({ name: "template_exercise_id", type: "uuid" })
  templateExerciseId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "float", nullable: true })
  weight: number | null;

  @Column({ type: "int", nullable: true })
  reps: number | null;

  @Column({ type: "int", nullable: true })
  rpe: number | null;

  @Column({ name: "is_warmup", type: "boolean", default: false })
  isWarmup: boolean;

  @Column({ name: "is_dropset", type: "boolean", default: false })
  isDropset: boolean;

  @Column({ name: "is_failure", type: "boolean", default: false })
  isFailure: boolean;

  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds: number | null;

  @Column({ type: "float", nullable: true })
  distance: number | null;

  @Column({ type: "int", default: 1 })
  revision: number;

  /** Logical time of the last client mutation; used for conflict resolution. */
  @Column({ name: "client_updated_at", type: "timestamptz", nullable: true })
  clientUpdatedAt: Date | null;

  @ManyToOne(() => WorkoutTemplateExercise, (e) => e.sets, { onDelete: "CASCADE" })
  @JoinColumn({ name: "template_exercise_id" })
  templateExercise: WorkoutTemplateExercise;
}
