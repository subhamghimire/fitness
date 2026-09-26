import { Entity, Column, Index } from "typeorm";
import { AbstractEntity } from "src/entities";

/**
 * Per-(user, exercise) rollup: current cumulative totals and absolute bests.
 *
 * Materialized projection refreshed by the background worker whenever a workout
 * containing the exercise is created/edited/deleted. The "exercise list" and
 * "progress dashboard" reads hit this small table (one row per exercise the
 * user has ever performed) — never a scan of historical sets.
 *
 * Best record references (workout/session/achievedAt) make the list endpoint
 * self-contained; the full PR *chain* lives in `personal_records`.
 */
@Entity("exercise_stats")
@Index("idx_exercise_stats_user_last_performed", ["userId", "lastPerformedAt"])
@Index("idx_exercise_stats_user_last_live", ["userId", "lastPerformedAt", "exerciseId"], {
  where: `"isDeleted" = false AND "deleted_at" IS NULL`
})
@Index("uq_exercise_stats_user_exercise", ["userId", "exerciseId"], { unique: true })
export class ExerciseStat extends AbstractEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "exercise_id", type: "uuid" })
  exerciseId: string;

  @Column({ name: "exercise_name", type: "varchar", length: 200, nullable: true })
  exerciseName: string | null;

  @Column({ name: "workout_count", type: "int", default: 0 })
  workoutCount: number;

  @Column({ name: "total_volume_kg", type: "double precision", default: 0 })
  totalVolumeKg: number;

  @Column({ name: "total_reps", type: "bigint", default: 0 })
  totalReps: number;

  @Column({ name: "first_performed_at", type: "timestamp", nullable: true })
  firstPerformedAt: Date | null;

  @Column({ name: "last_performed_at", type: "timestamp", nullable: true })
  lastPerformedAt: Date | null;

  // Absolute best values (max across every session).
  @Column({ name: "best_weight_kg", type: "double precision", nullable: true })
  bestWeightKg: number | null;

  @Column({ name: "best_reps", type: "int", nullable: true })
  bestReps: number | null;

  @Column({ name: "best_volume_kg", type: "double precision", nullable: true })
  bestVolumeKg: number | null;

  @Column({ name: "best_estimated_1rm_kg", type: "double precision", nullable: true })
  bestEstimated1RmKg: number | null;

  @Column({ name: "best_distance_m", type: "double precision", nullable: true })
  bestDistanceM: number | null;

  @Column({ name: "best_time_seconds", type: "int", nullable: true })
  bestTimeSeconds: number | null;

  // The session + workout that established each absolute best.
  @Column({ name: "best_weight_workout_id", type: "uuid", nullable: true })
  bestWeightWorkoutId: string | null;

  @Column({ name: "best_weight_workout_exercise_id", type: "uuid", nullable: true })
  bestWeightWorkoutExerciseId: string | null;

  @Column({ name: "best_weight_at", type: "timestamp", nullable: true })
  bestWeightAt: Date | null;

  @Column({ name: "best_reps_workout_id", type: "uuid", nullable: true })
  bestRepsWorkoutId: string | null;

  @Column({ name: "best_reps_workout_exercise_id", type: "uuid", nullable: true })
  bestRepsWorkoutExerciseId: string | null;

  @Column({ name: "best_reps_at", type: "timestamp", nullable: true })
  bestRepsAt: Date | null;

  @Column({ name: "best_volume_workout_id", type: "uuid", nullable: true })
  bestVolumeWorkoutId: string | null;

  @Column({ name: "best_volume_workout_exercise_id", type: "uuid", nullable: true })
  bestVolumeWorkoutExerciseId: string | null;

  @Column({ name: "best_volume_at", type: "timestamp", nullable: true })
  bestVolumeAt: Date | null;

  @Column({ name: "best_1rm_workout_id", type: "uuid", nullable: true })
  best1RmWorkoutId: string | null;

  @Column({ name: "best_1rm_workout_exercise_id", type: "uuid", nullable: true })
  best1RmWorkoutExerciseId: string | null;

  @Column({ name: "best_1rm_at", type: "timestamp", nullable: true })
  best1RmAt: Date | null;

  @Column({ name: "best_distance_workout_id", type: "uuid", nullable: true })
  bestDistanceWorkoutId: string | null;

  @Column({ name: "best_distance_workout_exercise_id", type: "uuid", nullable: true })
  bestDistanceWorkoutExerciseId: string | null;

  @Column({ name: "best_distance_at", type: "timestamp", nullable: true })
  bestDistanceAt: Date | null;

  @Column({ name: "best_time_workout_id", type: "uuid", nullable: true })
  bestTimeWorkoutId: string | null;

  @Column({ name: "best_time_workout_exercise_id", type: "uuid", nullable: true })
  bestTimeWorkoutExerciseId: string | null;

  @Column({ name: "best_time_at", type: "timestamp", nullable: true })
  bestTimeAt: Date | null;

  /**
   * Optional muscle-group tag for future grouped-volume breakdowns.
   * Populated once the exercise catalog carries primary muscle metadata; until
   * then it stays null and muscle-group volume endpoints are simply not served.
   */
  @Column({ name: "muscle_group", type: "varchar", length: 80, nullable: true })
  muscleGroup: string | null;
}
