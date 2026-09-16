import { Entity, Column, ManyToOne, OneToMany, JoinColumn, Index } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Workout } from "./workout.entity";
import { Exercise } from "../../exercise/entities/exercise.entity";
import { Set } from "./set.entity";

/**
 * WORKOUT EXERCISE — an exercise actually performed during a workout session.
 *
 * `exercise_id` is a soft reference into the reusable exercise catalog. It is
 * nullable so user history survives a catalog exercise being hard-deleted;
 * `name` is the denormalized display name captured at sync time.
 */
@Entity("workout_exercises")
export class WorkoutExercise extends AbstractEntity {
  @Index()
  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Index()
  @Column({ name: "exercise_id", type: "uuid", nullable: true })
  exerciseId: string | null;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ name: "rest_seconds", type: "int", nullable: true })
  restSeconds: number | null;

  /** Denormalized exercise name from client for sync without catalog dependency */
  @Column({ type: "varchar", length: 200, nullable: true })
  name: string | null;

  @Column({ type: "int", default: 1 })
  revision: number;

  /** Logical time of the last client mutation; used for conflict resolution. */
  @Column({ name: "client_updated_at", type: "timestamptz", nullable: true })
  clientUpdatedAt: Date | null;

  @ManyToOne(() => Workout, (w) => w.workoutExercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_id" })
  workout: Workout;

  @ManyToOne(() => Exercise, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise | null;

  @OneToMany(() => Set, (s) => s.workoutExercise, { cascade: true })
  sets: Set[];
}
