import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type ProgressQueueStatus = "pending" | "processing" | "failed";

export const PROGRESS_QUEUE_MAX_ATTEMPTS = 5;

/**
 * Durable projection work queue (1 row per changed workout).
 *
 * Intentionally does NOT extend AbstractEntity — like `sync_changes` it is
 * infrastructure metadata, not a domain entity.
 *
 * Producers enqueue rows *inside the same transaction* that mutates the workout
 * (see ProgressQueueService.enqueueWorkoutsInTransaction), so a commit and its
 * projection work never diverge. The worker claims rows with
 * `FOR UPDATE SKIP LOCKED`, so multiple app instances can drain the queue
 * safely. Enqueues are deduplicated by the unique (user_id, workout_id) key and
 * projection treat a workout as replace-on-write — both make sync retries
 * idempotent instead of double-counting metrics.
 */
@Entity("progress_workout_queue")
export class ProgressQueueItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Column({ type: "varchar", length: 20, default: "modified" })
  reason: string;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status: ProgressQueueStatus;

  @Column({ name: "attempt_count", type: "int", default: 0 })
  attemptCount: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "NOW()" })
  updatedAt: Date;
}
