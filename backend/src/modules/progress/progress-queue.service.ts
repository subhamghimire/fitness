import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, IsNull, Repository } from "typeorm";
import { ProgressQueueItem, PROGRESS_QUEUE_MAX_ATTEMPTS } from "./entities/progress-queue-item.entity";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";

/** Minimal structural projection of the sync batch change items we care about. */
export interface ProgressChangeInput {
  workouts?: Array<{ id: string; payload?: Record<string, unknown> | null }>;
  workoutExercises?: Array<{ id: string; payload?: Record<string, unknown> | null }>;
  sets?: Array<{ id: string; payload?: Record<string, unknown> | null }>;
}

/**
 * PROGRESS QUEUE PRODUCER
 *
 * Owns every way a workout is added to the projection work queue. The critical
 * contract for correctness is `enqueueWorkoutsInTransaction`: it is called from
 * INSIDE the sync transaction, so a committed workout mutation always has its
 * projection work scheduled — there is no crash window where the workout is
 * saved but never reprojected.
 *
 * Retry safety: the queue has a unique (user_id, workout_id) key, so retries
 * coalesce into a single pending row, and the projection itself is an idempotent
 * replace-on-write. A retried sync batch therefore never double-counts metrics.
 *
 * All persistence goes through TypeORM's Data Mapper APIs — the enqueue upsert
 * is `EntityManager.upsert` against the unique key, so retries reset the row to
 * pending without a raw `ON CONFLICT` statement.
 */
@Injectable()
export class ProgressQueueService {
  private readonly logger = new Logger(ProgressQueueService.name);

  constructor(
    @InjectRepository(ProgressQueueItem) private readonly queueRepo: Repository<ProgressQueueItem>,
    @InjectRepository(Workout) private readonly workoutRepo: Repository<Workout>
  ) {}

  /**
   * Resolves the set of workout ids indirectly mutated by exercise/set-level
   * changes, then schedules projection work inside the caller's transaction.
   */
  async enqueueWorkoutsInTransaction(manager: EntityManager, userId: string, changes: ProgressChangeInput, reason = "modified"): Promise<void> {
    const ids = await this.resolveChangedWorkoutIds(manager, userId, changes);
    if (ids.length === 0) return;
    await this.insertQueueRows(manager, userId, ids, reason);
  }

  /**
   * Standalone enqueue (e.g. operational backfill for pre-existing history).
   * Idempotent via the unique (user_id, workout_id) key — existing queue rows
   * are left untouched (`ON CONFLICT DO NOTHING`).
   */
  async enqueueUserHistory(userId: string): Promise<number> {
    const workouts = await this.workoutRepo.find({
      where: { userId, isDeleted: false, deletedAt: IsNull() },
      select: { id: true }
    });
    if (workouts.length === 0) return 0;

    const result = await this.queueRepo
      .createQueryBuilder()
      .insert()
      .into(ProgressQueueItem)
      .values(workouts.map((workout) => ({ userId, workoutId: workout.id, reason: "backfill", status: "pending" as const, attemptCount: 0 })))
      .orIgnore()
      .execute();

    // `identifiers` counts every attempted value even when ON CONFLICT skips
    // the row; `raw` holds only the rows actually returned (i.e. inserted).
    return Array.isArray(result.raw) ? result.raw.length : 0;
  }

  private async resolveChangedWorkoutIds(manager: EntityManager, userId: string, changes: ProgressChangeInput): Promise<string[]> {
    const ids = new Set<string>();

    for (const item of changes.workouts ?? []) {
      ids.add(item.id);
    }
    for (const item of changes.workoutExercises ?? []) {
      const workoutId = item.payload?.workoutId as string | undefined;
      if (workoutId) ids.add(workoutId);
    }

    const exerciseIds = (changes.sets ?? []).map((s) => s.payload?.workoutExerciseId as string | undefined).filter((x): x is string => Boolean(x));
    if (exerciseIds.length > 0) {
      const rows = await manager.find(WorkoutExercise, { where: { id: In(exerciseIds) }, select: { workoutId: true } });
      for (const row of rows) ids.add(row.workoutId);
    }

    return this.filterOwnedWorkoutIds(manager, userId, [...ids]);
  }

  /**
   * Defensive ownership pass: an attacker could reference another user's
   * workout ids in a payload; never schedule projection outside the owner.
   */
  private async filterOwnedWorkoutIds(manager: EntityManager, userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const rows = await manager.find(Workout, { where: { id: In(unique), userId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  private async insertQueueRows(manager: EntityManager, userId: string, workoutIds: string[], reason: string): Promise<void> {
    for (const workoutId of workoutIds) {
      await manager.upsert(
        ProgressQueueItem,
        {
          userId,
          workoutId,
          reason,
          status: "pending",
          attemptCount: 0,
          lastError: null,
          processedAt: null,
          updatedAt: new Date()
        },
        { conflictPaths: ["userId", "workoutId"] }
      );
    }
  }
}

export { PROGRESS_QUEUE_MAX_ATTEMPTS };
