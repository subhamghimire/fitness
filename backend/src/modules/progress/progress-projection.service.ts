import { Injectable, Logger } from "@nestjs/common";
import { DataSource, DeepPartial, EntityManager, In, IsNull } from "typeorm";
import { PersonalRecordType } from "./enums/progress.enum";
import { computeWorkoutStat, computeSessionStat, aggregateExerciseStats, detectPersonalRecords, SessionInput, SessionStat, RecordRef } from "./progress.calculator";
import { PROGRESS_QUEUE_MAX_ATTEMPTS, ProgressQueueItem } from "./entities/progress-queue-item.entity";
import { WorkoutStat } from "./entities/workout-stat.entity";
import { WorkoutExerciseStat } from "./entities/workout-exercise-stat.entity";
import { ExerciseStat } from "./entities/exercise-stat.entity";
import { PersonalRecord } from "./entities/personal-record.entity";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";
import { Set as SetEntity } from "../workout/entities/set.entity";

export interface ClaimedQueueRow {
  id: number;
  userId: string;
  workoutId: string;
  attemptCount: number;
  reason: string;
}

export interface ProcessQueueResult {
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * PROGRESS PROJECTION SERVICE
 *
 * Rebuilds the materialized statistics asynchronously from source-of-truth
 * workout rows. It is the only writer to all four projection tables
 * (`workout_stats`, `workout_exercise_stats`, `exercise_stats`,
 * `personal_records`).
 *
 * Design invariants:
 *
 *   1. IDEMPOTENT REPLACE-ON-WRITE — a workout's contribution is always fully
 *      removed then rewritten (never incremented), so a retried/duplicated
 *      queue item can never double-count volume, reps or frequency.
 *   2. PRS ARE DERIVED, NEVER HAND-EDITED — regenerating the full PR chain for
 *      a (user, exercise) on every mutation means an edit or deletion can
 *      never leave a stale PR behind. Deleted workouts contribute zero
 *      sessions, so their PRs simply disappear from the chain.
 *   3. BOUNDED READS — the dashboard/time-series APIs aggregate over
 *      `workout_stats` (one row per workout) and per-exercise rolls live in
 *      `exercise_stats`/`workout_exercise_stats`. Historical `sets` rows are
 *      never scanned per request.
 *   4. PER-WORKOUT TRANSACTIONS — each claimed workout is reprojected and
 *      marked done in its own transaction, so one poisoned workout cannot
 *      roll back the rest of the batch. Stale `processing` rows are harvested
 *      back to `pending` by the next claim (crash recovery).
 *
 * The costly per-exercise regeneration is O(number of sessions for that
 * exercise) and only touches exercises actually present in a changed workout,
 * bounded by the affected set rather than full-history recompute.
 *
 * All persistence goes through TypeORM's Data Mapper / QueryBuilder APIs (no
 * raw SQL strings) so the projection stays schema-safe under renames and
 * driver-portable.
 */
@Injectable()
export class ProgressProjectionService {
  private readonly logger = new Logger(ProgressProjectionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async processQueue(batchSize = 25): Promise<ProcessQueueResult> {
    await this.recoverStaleProcessingRows();

    let claimed: ClaimedQueueRow[];
    const claimQr = this.dataSource.createQueryRunner();
    await claimQr.connect();
    try {
      await claimQr.startTransaction();

      // Lock-and-skip: concurrent workers each grab a disjoint batch without
      // blocking on one another.
      const rows = await claimQr.manager
        .createQueryBuilder(ProgressQueueItem, "q")
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .where("q.status = :status", { status: "pending" })
        .andWhere("q.attemptCount < :max", { max: PROGRESS_QUEUE_MAX_ATTEMPTS })
        .orderBy("q.id", "ASC")
        .limit(batchSize)
        .getMany();

      if (rows.length > 0) {
        await claimQr.manager
          .createQueryBuilder()
          .update(ProgressQueueItem)
          .set({
            status: "processing",
            processedAt: () => "NOW()",
            attemptCount: () => '"attempt_count" + 1',
            updatedAt: () => "NOW()"
          })
          .whereInIds(rows.map((r) => r.id))
          .execute();
      }

      claimed = rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        workoutId: r.workoutId,
        attemptCount: r.attemptCount + 1, // reflects the increment above
        reason: r.reason
      }));
      await claimQr.commitTransaction();
    } catch (e) {
      this.logger.error("Failed to claim progress queue rows", e instanceof Error ? e.stack : String(e));
      throw e;
    } finally {
      await claimQr.release();
    }

    if (claimed.length === 0) return { claimed: 0, processed: 0, failed: 0 };

    const result: ProcessQueueResult = { claimed: claimed.length, processed: 0, failed: 0 };
    for (const row of claimed) {
      if (await this.processWorkout(row)) {
        result.processed++;
      } else {
        result.failed++;
      }
    }
    return result;
  }

  private async processWorkout(row: ClaimedQueueRow): Promise<boolean> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      await this.recomputeWorkout(qr.manager, row.userId, row.workoutId);
      await qr.manager.delete(ProgressQueueItem, { id: row.id });
      await qr.commitTransaction();
      return true;
    } catch (e) {
      await qr.rollbackTransaction();
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Workout reprojection failed (workout=${row.workoutId})`, message);
      await this.markRowFailed(qr, row, message);
      return false;
    } finally {
      await qr.release();
    }
  }

  private async markRowFailed(qr: ReturnType<DataSource["createQueryRunner"]>, row: ClaimedQueueRow, message: string): Promise<void> {
    const attempt = row.attemptCount; // already incremented at claim time
    try {
      await qr.startTransaction();
      const exhausted = attempt >= PROGRESS_QUEUE_MAX_ATTEMPTS;
      await qr.manager.update(
        ProgressQueueItem,
        { id: row.id },
        {
          status: exhausted ? "failed" : "pending",
          processedAt: exhausted ? () => "NOW()" : null,
          lastError: message.slice(0, 2000),
          updatedAt: () => "NOW()"
        }
      );
      await qr.commitTransaction();
    } catch (markErr) {
      await qr.rollbackTransaction();
      this.logger.error(`Failed to mark queue row ${row.id} failed`, markErr instanceof Error ? markErr.stack : String(markErr));
    }
  }

  private async recoverStaleProcessingRows(): Promise<void> {
    // Harvest rows left in `processing` by a crashed consumer.
    await this.dataSource
      .createQueryBuilder()
      .update(ProgressQueueItem)
      .set({ status: "pending", updatedAt: () => "NOW()" })
      .where("status = :status", { status: "processing" })
      .andWhere("processed_at < NOW() - INTERVAL '10 minutes'")
      .execute();
  }

  /**
   * Recomputes the projection rows for a single workout. `manager` is expected
   * to be a transaction-scoped manager (idempotence must be transactional).
   */
  async recomputeWorkout(manager: EntityManager, userId: string, workoutId: string): Promise<void> {
    const workout = await manager.getRepository(Workout).findOne({ where: { id: workoutId } });

    const oldSessions = await manager.getRepository(WorkoutExerciseStat).find({
      where: { userId, workoutId },
      select: { exerciseId: true }
    });

    await manager.delete(WorkoutStat, { userId, workoutId });
    await manager.delete(WorkoutExerciseStat, { userId, workoutId });

    const newExerciseIds: string[] = [];

    if (workout && !workout.isDeleted && !workout.deletedAt) {
      const sessions = await this.loadWorkoutSessions(manager, workoutId, workout);
      const workoutStat = computeWorkoutStat(
        {
          workoutId,
          name: workout.name,
          startedAt: workout.startedAt,
          endedAt: workout.endedAt,
          durationSeconds: workout.durationSeconds
        },
        sessions
      );
      await manager.insert(WorkoutStat, {
        userId,
        workoutId,
        name: workoutStat.name,
        startedAt: workoutStat.startedAt,
        durationSeconds: workoutStat.durationSeconds,
        volumeKg: workoutStat.volumeKg,
        reps: workoutStat.reps,
        setCount: workoutStat.setCount,
        exerciseCount: workoutStat.exerciseCount
      });

      const sessionStats = sessions.map(computeSessionStat);
      const sessionRows: DeepPartial<WorkoutExerciseStat>[] = [];
      for (const stat of sessionStats) {
        if (!stat.exerciseId) continue;
        sessionRows.push({
          userId,
          workoutId: stat.workoutId,
          workoutExerciseId: stat.workoutExerciseId,
          exerciseId: stat.exerciseId,
          name: stat.name,
          startedAt: stat.startedAt,
          setCount: stat.setCount,
          reps: stat.reps,
          volumeKg: stat.volumeKg,
          bestWeightKg: stat.bestWeightKg,
          bestReps: stat.bestReps,
          bestEstimated1RmKg: stat.bestEstimated1RmKg,
          bestDistanceM: stat.bestDistanceM,
          bestTimeSeconds: stat.bestTimeSeconds
        });
        newExerciseIds.push(stat.exerciseId);
      }
      if (sessionRows.length > 0) {
        await manager.insert(WorkoutExerciseStat, sessionRows);
      }
    }

    const affected = new Set([...oldSessions.map((r) => r.exerciseId).filter((x): x is string => Boolean(x)), ...newExerciseIds]);
    for (const exerciseId of affected) {
      await this.regenerateExercise(manager, userId, exerciseId);
    }
  }

  private async loadWorkoutSessions(
    manager: EntityManager,
    workoutId: string,
    workout: { name: string | null; startedAt: Date; endedAt: Date | null; durationSeconds: number | null }
  ): Promise<SessionInput[]> {
    const exercises = await manager.getRepository(WorkoutExercise).find({
      where: { workoutId, isDeleted: false, deletedAt: IsNull() },
      order: { orderIndex: "ASC", id: "ASC" }
    });

    const setsByExercise = new Map<string, SetEntity[]>();
    if (exercises.length > 0) {
      const sets = await manager.getRepository(SetEntity).find({
        where: { workoutExerciseId: In(exercises.map((e) => e.id)), isDeleted: false, deletedAt: IsNull() },
        order: { orderIndex: "ASC", id: "ASC" }
      });
      for (const set of sets) {
        const existing = setsByExercise.get(set.workoutExerciseId);
        if (existing) existing.push(set);
        else setsByExercise.set(set.workoutExerciseId, [set]);
      }
    }

    return exercises.map((we) => ({
      workoutId,
      workoutExerciseId: we.id,
      exerciseId: we.exerciseId,
      name: we.name,
      startedAt: workout.startedAt,
      sets: (setsByExercise.get(we.id) ?? []).map((s) => ({
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
        isDropset: s.isDropset,
        isFailure: s.isFailure,
        durationSeconds: s.durationSeconds,
        distance: s.distance,
        orderIndex: s.orderIndex
      }))
    }));
  }

  /** Rebuilds exercise_stats + the full PR chain for one (user, exercise). */
  private async regenerateExercise(manager: EntityManager, userId: string, exerciseId: string): Promise<void> {
    const entities = await manager.getRepository(WorkoutExerciseStat).find({
      where: { userId, exerciseId },
      order: { startedAt: "ASC", workoutId: "ASC", workoutExerciseId: "ASC" }
    });

    const rows: SessionStat[] = entities.map((e) => ({
      workoutId: e.workoutId,
      workoutExerciseId: e.workoutExerciseId,
      exerciseId: e.exerciseId,
      name: e.name,
      startedAt: e.startedAt,
      setCount: e.setCount,
      reps: e.reps,
      volumeKg: e.volumeKg,
      bestWeightKg: e.bestWeightKg,
      bestReps: e.bestReps,
      bestEstimated1RmKg: e.bestEstimated1RmKg,
      bestDistanceM: e.bestDistanceM,
      bestTimeSeconds: e.bestTimeSeconds
    }));

    const aggregate = aggregateExerciseStats(rows);
    const events = detectPersonalRecords(rows);
    const latestName = rows.reduce((acc: string | null, r) => r.name ?? acc, null);

    await manager.delete(ExerciseStat, { userId, exerciseId });
    await manager.delete(PersonalRecord, { userId, exerciseId });

    if (rows.length > 0) {
      await manager.insert(ExerciseStat, this.buildExerciseStat(userId, exerciseId, latestName, aggregate.best, aggregate));
    }

    if (events.length > 0) {
      await manager.insert(
        PersonalRecord,
        events.map((event) => ({
          userId,
          exerciseId,
          exerciseName: latestName,
          prType: event.prType,
          value: event.value,
          workoutId: event.workoutId,
          workoutExerciseId: event.workoutExerciseId,
          achievedAt: event.achievedAt
        }))
      );
    }
  }

  private buildExerciseStat(
    userId: string,
    exerciseId: string,
    exerciseName: string | null,
    best: Partial<Record<PersonalRecordType, RecordRef>>,
    aggregate: { workoutCount: number; totalVolumeKg: number; totalReps: number; firstPerformedAt: Date | null; lastPerformedAt: Date | null }
  ): DeepPartial<ExerciseStat> {
    const ref = (t: PersonalRecordType): RecordRef | undefined => best[t];

    return {
      userId,
      exerciseId,
      exerciseName,
      workoutCount: aggregate.workoutCount,
      totalVolumeKg: aggregate.totalVolumeKg,
      totalReps: aggregate.totalReps,
      firstPerformedAt: aggregate.firstPerformedAt,
      lastPerformedAt: aggregate.lastPerformedAt,
      bestWeightKg: ref(PersonalRecordType.BEST_WEIGHT_KG)?.value ?? null,
      bestWeightWorkoutId: ref(PersonalRecordType.BEST_WEIGHT_KG)?.workoutId ?? null,
      bestWeightWorkoutExerciseId: ref(PersonalRecordType.BEST_WEIGHT_KG)?.workoutExerciseId ?? null,
      bestWeightAt: ref(PersonalRecordType.BEST_WEIGHT_KG)?.achievedAt ?? null,
      bestReps: ref(PersonalRecordType.BEST_REPS)?.value ?? null,
      bestRepsWorkoutId: ref(PersonalRecordType.BEST_REPS)?.workoutId ?? null,
      bestRepsWorkoutExerciseId: ref(PersonalRecordType.BEST_REPS)?.workoutExerciseId ?? null,
      bestRepsAt: ref(PersonalRecordType.BEST_REPS)?.achievedAt ?? null,
      bestVolumeKg: ref(PersonalRecordType.BEST_VOLUME_KG)?.value ?? null,
      bestVolumeWorkoutId: ref(PersonalRecordType.BEST_VOLUME_KG)?.workoutId ?? null,
      bestVolumeWorkoutExerciseId: ref(PersonalRecordType.BEST_VOLUME_KG)?.workoutExerciseId ?? null,
      bestVolumeAt: ref(PersonalRecordType.BEST_VOLUME_KG)?.achievedAt ?? null,
      bestEstimated1RmKg: ref(PersonalRecordType.BEST_ESTIMATED_1RM_KG)?.value ?? null,
      best1RmWorkoutId: ref(PersonalRecordType.BEST_ESTIMATED_1RM_KG)?.workoutId ?? null,
      best1RmWorkoutExerciseId: ref(PersonalRecordType.BEST_ESTIMATED_1RM_KG)?.workoutExerciseId ?? null,
      best1RmAt: ref(PersonalRecordType.BEST_ESTIMATED_1RM_KG)?.achievedAt ?? null,
      bestDistanceM: ref(PersonalRecordType.BEST_DISTANCE_M)?.value ?? null,
      bestDistanceWorkoutId: ref(PersonalRecordType.BEST_DISTANCE_M)?.workoutId ?? null,
      bestDistanceWorkoutExerciseId: ref(PersonalRecordType.BEST_DISTANCE_M)?.workoutExerciseId ?? null,
      bestDistanceAt: ref(PersonalRecordType.BEST_DISTANCE_M)?.achievedAt ?? null,
      bestTimeSeconds: ref(PersonalRecordType.BEST_TIME_SECONDS)?.value ?? null,
      bestTimeWorkoutId: ref(PersonalRecordType.BEST_TIME_SECONDS)?.workoutId ?? null,
      bestTimeWorkoutExerciseId: ref(PersonalRecordType.BEST_TIME_SECONDS)?.workoutExerciseId ?? null,
      bestTimeAt: ref(PersonalRecordType.BEST_TIME_SECONDS)?.achievedAt ?? null
    };
  }
}
