import { Entity, Column, Index } from "typeorm";
import { AbstractEntity } from "src/entities";

/**
 * Per-workout aggregate (1 row per performed workout).
 *
 * Materialized projection — the dashboard/time-series reads aggregate over this
 * table (bounded: one row per workout) instead of scanning the `sets` table
 * (unbounded). Rebuilt idempotently by the background projection worker on
 * every workout mutation.
 */
@Entity("workout_stats")
@Index("idx_workout_stats_user_started", ["userId", "startedAt"])
export class WorkoutStat extends AbstractEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Index("uq_workout_stats_workout", { unique: true })
  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Column({ type: "varchar", length: 150, nullable: true })
  name: string | null;

  @Column({ name: "started_at", type: "timestamp" })
  startedAt: Date;

  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds: number | null;

  @Column({ name: "volume_kg", type: "double precision", default: 0 })
  volumeKg: number;

  @Column({ type: "int", default: 0 })
  reps: number;

  @Column({ name: "set_count", type: "int", default: 0 })
  setCount: number;

  @Column({ name: "exercise_count", type: "int", default: 0 })
  exerciseCount: number;
}
