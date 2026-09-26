import { Entity, Column, Index } from "typeorm";
import { AbstractEntity } from "src/entities";

/**
 * Per-workout-per-exercise aggregate (1 row per performed exercise session).
 *
 * Materialized projection. Session scans for PR detection / exercise history
 * read this table (one row per session) rather than joining through the full
 * `sets` scan path.
 *
 * `exercise_id` is a soft reference (no FK, matching the workout_exercises
 * "history survives catalog deletion" philosophy); it is snapshot-keyed here so
 * projections never orphan when the catalog row disappears. `started_at` is
 * denormalized from the parent workout so chronological scans are single-table.
 */
@Entity("workout_exercise_stats")
@Index("idx_wes_user_exercise_started", ["userId", "exerciseId", "startedAt"])
@Index("idx_wes_user_exercise_started_live", ["userId", "exerciseId", "startedAt", "workoutId"], {
  where: `"isDeleted" = false AND "deleted_at" IS NULL`
})
@Index("uq_wes_workout_exercise", ["workoutId", "exerciseId"], { unique: true })
@Index("uq_wes_workout_exercise_id", ["workoutExerciseId"], { unique: true })
export class WorkoutExerciseStat extends AbstractEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Column({ name: "workout_exercise_id", type: "uuid" })
  workoutExerciseId: string;

  @Column({ name: "exercise_id", type: "uuid", nullable: true })
  exerciseId: string | null;

  @Column({ type: "varchar", length: 200, nullable: true })
  name: string | null;

  @Column({ name: "started_at", type: "timestamp" })
  startedAt: Date;

  @Column({ name: "set_count", type: "int", default: 0 })
  setCount: number;

  @Column({ type: "int", default: 0 })
  reps: number;

  @Column({ name: "volume_kg", type: "double precision", default: 0 })
  volumeKg: number;

  @Column({ name: "best_weight_kg", type: "double precision", nullable: true })
  bestWeightKg: number | null;

  @Column({ name: "best_reps", type: "int", nullable: true })
  bestReps: number | null;

  @Column({ name: "best_estimated_1rm_kg", type: "double precision", nullable: true })
  bestEstimated1RmKg: number | null;

  @Column({ name: "best_distance_m", type: "double precision", nullable: true })
  bestDistanceM: number | null;

  @Column({ name: "best_time_seconds", type: "int", nullable: true })
  bestTimeSeconds: number | null;
}
