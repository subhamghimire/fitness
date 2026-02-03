import { Entity, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { WorkoutExercise } from "./workout-exercise.entity";
import { AbstractEntity } from "src/entities";

@Entity("sets")
export class Set extends AbstractEntity {
  @Index()
  @Column({ name: "workout_exercise_id", type: "uuid" })
  workoutExerciseId: string;

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

  @ManyToOne(() => WorkoutExercise, (we) => we.sets, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_exercise_id" })
  workoutExercise: WorkoutExercise;
}
