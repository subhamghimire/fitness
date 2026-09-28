import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";
import { Workout } from "./entities/workout.entity";
import { WorkoutExercise } from "./entities/workout-exercise.entity";
import { Set } from "./entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { ExerciseService } from "../exercise/exercise.service";
import { User } from "../users/entities/user.entity";
import { SyncChange } from "../sync/entities/sync-change.entity";
import { resolveWinner, isIdempotentReplay } from "./workout-conflict.util";
import { createPaginatedResponse } from "src/common/dto";
import { buildIdempotencyKey, DomainAggregateType, DomainEventPublisher, DomainEventType, WorkoutCompletedEvent } from "src/common/events";
import {
  ExerciseHistoryEntryDto,
  ExerciseHistoryQueryDto,
  WorkoutDetailResponseDto,
  WorkoutExerciseSummaryDto,
  WorkoutHistoryQueryDto,
  WorkoutSummaryResponseDto,
  SetResponseDto
} from "./dto";
import { WorkoutSyncChangeItem, SyncApplyAccepted, SyncApplyRejected, SyncApplyConflict, SyncOperation } from "./types/sync-apply.types";

/**
 * WORKOUT SESSION domain service.
 *
 * Owns every business rule around performed workouts: offline-first change
 * application (ownership, LWW conflict resolution, tombstones), and read APIs
 * for workout history/detail/recent/exercise-history.
 *
 * The `apply*Change(manager, ...)` methods participate in a caller-owned
 * transaction (managed by SyncModule) so persistence plus the sync changelog
 * commit atomically.
 *
 * A finished workout also announces itself, via `DomainEventPublisher` — the
 * outbox row is written **inside the same transaction**, so a committed workout
 * always has its event and a rolled-back one never leaves it behind. That
 * publisher performs a single INSERT and no provider I/O, which is what makes
 * "a failed notification cannot fail the workout write" true by construction.
 * Nothing here knows what a channel, a template or a provider is.
 */
@Injectable()
export class WorkoutService {
  private readonly logger = new Logger(WorkoutService.name);

  constructor(
    @InjectRepository(Workout) private readonly workoutsRepo: Repository<Workout>,
    @InjectRepository(WorkoutExercise) private readonly workoutExercisesRepo: Repository<WorkoutExercise>,
    @InjectRepository(Set) private readonly setsRepo: Repository<Set>,
    @InjectRepository(Exercise) private readonly exercisesRepo: Repository<Exercise>,
    private readonly exerciseService: ExerciseService,
    private readonly eventPublisher: DomainEventPublisher
  ) {}

  // ─── Offline-first change application (called inside the sync transaction) ─

  async applyWorkoutChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const existing = await manager.findOne(Workout, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "workout", id: item.id, reason: "ownership" });
      return;
    }

    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "workout", item.id, "delete", item.revision);
        accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "workout",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "workout", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(Workout, existing);
      await this.recordChange(manager, user.id, "workout", item.id, "delete", existing.revision);
      accepted.push({ entityType: "workout", id: item.id, revision: existing.revision });
      return;
    }

    const p = item.payload || {};
    if (existing) {
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: false,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "workout",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "workout", id: item.id, revision: serverRevision });
        return;
      }
      const wasCompleted = existing.endedAt !== null && existing.endedAt !== undefined;
      existing.name = (p.name as string) ?? existing.name;
      existing.notes = (p.notes as string) ?? existing.notes;
      if (p.startedAt) existing.startedAt = new Date(p.startedAt as string);
      existing.endedAt = p.endedAt ? new Date(p.endedAt as string) : existing.endedAt;
      existing.durationSeconds = (p.durationSeconds as number) ?? existing.durationSeconds;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(Workout, existing);
      await this.recordChange(manager, user.id, "workout", item.id, "update", existing.revision);
      await this.announceCompletion(manager, user, existing, wasCompleted);
    } else {
      const startedAt = new Date((p.startedAt as string) || item.clientUpdatedAt);
      const endedAt = p.endedAt ? new Date(p.endedAt as string) : null;
      await manager.insert(Workout, {
        id: item.id,
        userId: user.id,
        name: (p.name as string) ?? null,
        notes: (p.notes as string) ?? null,
        startedAt,
        endedAt,
        durationSeconds: (p.durationSeconds as number) ?? null,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "workout", item.id, "create", item.revision);
      // A session that arrives already finished (the common case: a phone syncs
      // once, offline, having recorded the whole session) has just been completed
      // too — there was never an earlier "in progress" state to transition from.
      await this.announceCompletion(
        manager,
        user,
        { id: item.id, name: (p.name as string) ?? null, startedAt, endedAt, durationSeconds: (p.durationSeconds as number) ?? null },
        false
      );
    }
    accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
  }

  /**
   * Announces "this workout was finished", once per completion.
   *
   * Only the *transition* counts: an update that leaves an already-finished
   * workout finished (a name correction, a note) must not re-notify a coach. The
   * idempotency key carries `startedAt` so a replayed offline batch — the same
   * session reported twice — collapses to one event even though it arrives
   * through two separate writes, while a genuinely new session does not.
   *
   * The audience is resolved lazily by the notification layer, so this method
   * never queries who coaches this athlete; it just says "this user, plus their
   * active coaches, minus the athlete themselves".
   */
  private async announceCompletion(
    manager: EntityManager,
    user: User,
    workout: { id: string; name: string | null; startedAt: Date; endedAt: Date | null; durationSeconds: number | null },
    wasCompleted: boolean
  ): Promise<void> {
    if (wasCompleted || !workout.endedAt) return;

    const event: WorkoutCompletedEvent = {
      type: DomainEventType.WORKOUT_COMPLETED,
      occurredAt: workout.endedAt,
      idempotencyKey: buildIdempotencyKey(DomainEventType.WORKOUT_COMPLETED, workout.id, workout.startedAt.toISOString()),
      actorId: user.id,
      audience: { kind: "user_and_active_coach", userId: user.id, excludeActor: true },
      aggregate: { type: DomainAggregateType.WORKOUT, id: workout.id },
      payload: {
        workoutId: workout.id,
        workoutName: workout.name,
        startedAt: workout.startedAt.toISOString(),
        endedAt: workout.endedAt.toISOString(),
        durationSeconds: workout.durationSeconds
      }
    };
    await this.eventPublisher.publishInTransaction(manager, event);
  }

  async applyWorkoutExerciseChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const p = item.payload || {};
    const existing = await manager.findOne(WorkoutExercise, { where: { id: item.id } });

    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "workoutExercise", item.id, "delete", item.revision);
        accepted.push({ entityType: "workoutExercise", id: item.id, revision: item.revision });
        return;
      }
      if (!(await this.userOwnsWorkoutExercise(manager, user.id, existing))) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "workoutExercise",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "workoutExercise", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(WorkoutExercise, existing);
      await this.recordChange(manager, user.id, "workoutExercise", item.id, "delete", existing.revision);
      accepted.push({ entityType: "workoutExercise", id: item.id, revision: existing.revision });
      return;
    }

    let exerciseId = (p.exerciseId as string) || null;
    const name = (p.name as string) || null;
    if (!exerciseId && name) {
      const custom = await this.exerciseService.findOrCreateCustomExercise(manager, name);
      exerciseId = custom.id;
    } else if (exerciseId) {
      const catalogExercise = await manager.findOne(Exercise, { where: { id: exerciseId } });
      if (!catalogExercise) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "unknown_exercise" });
        return;
      }
    }
    if (!exerciseId) {
      rejected.push({ entityType: "workoutExercise", id: item.id, reason: "missing_exercise" });
      return;
    }
    const workoutId = (p.workoutId as string) || null;
    if (!workoutId) {
      rejected.push({ entityType: "workoutExercise", id: item.id, reason: "missing_workout" });
      return;
    }

    if (existing) {
      if (!(await this.userOwnsWorkoutExercise(manager, user.id, existing))) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
        return;
      }
      if (existing.workoutId !== workoutId) {
        const target = await manager.findOne(Workout, { where: { id: workoutId } });
        if (!target || target.userId !== user.id) {
          rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
          return;
        }
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: false,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "workoutExercise",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "workoutExercise", id: item.id, revision: serverRevision });
        return;
      }
      existing.workoutId = workoutId;
      existing.exerciseId = exerciseId;
      existing.name = name;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.notes = (p.notes as string) ?? existing.notes;
      existing.restSeconds = (p.restSeconds as number) ?? existing.restSeconds;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(WorkoutExercise, existing);
      await this.recordChange(manager, user.id, "workoutExercise", item.id, "update", existing.revision);
    } else {
      const target = await manager.findOne(Workout, { where: { id: workoutId } });
      if (!target || target.userId !== user.id) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
        return;
      }
      await manager.insert(WorkoutExercise, {
        id: item.id,
        workoutId,
        exerciseId,
        name,
        orderIndex: (p.orderIndex as number) ?? 0,
        notes: (p.notes as string) ?? null,
        restSeconds: (p.restSeconds as number) ?? null,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "workoutExercise", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "workoutExercise", id: item.id, revision: item.revision });
  }

  async applySetChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const p = item.payload || {};
    const existing = await manager.findOne(Set, { where: { id: item.id } });

    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "set", item.id, "delete", item.revision);
        accepted.push({ entityType: "set", id: item.id, revision: item.revision });
        return;
      }
      if (!(await this.userOwnsSet(manager, user.id, existing))) {
        rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "set",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "set", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(Set, existing);
      await this.recordChange(manager, user.id, "set", item.id, "delete", existing.revision);
      accepted.push({ entityType: "set", id: item.id, revision: existing.revision });
      return;
    }

    const workoutExerciseId = p.workoutExerciseId as string;
    if (!workoutExerciseId) {
      rejected.push({ entityType: "set", id: item.id, reason: "missing_exercise" });
      return;
    }

    if (existing) {
      if (!(await this.userOwnsSet(manager, user.id, existing))) {
        rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
        return;
      }
      if (existing.workoutExerciseId !== workoutExerciseId) {
        if (!(await this.workoutExerciseOwnedBy(manager, workoutExerciseId, user.id))) {
          rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
          return;
        }
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: false,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
          conflicts.push({
            entityType: "set",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "set", id: item.id, revision: serverRevision });
        return;
      }
      existing.workoutExerciseId = workoutExerciseId;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.weight = (p.weight as number) ?? null;
      existing.reps = (p.reps as number) ?? null;
      existing.rpe = (p.rpe as number) ?? existing.rpe;
      existing.isWarmup = Boolean(p.isWarmup);
      existing.isDropset = Boolean(p.isDropset);
      existing.isFailure = Boolean(p.isFailure);
      existing.durationSeconds = (p.durationSeconds as number) ?? existing.durationSeconds;
      existing.distance = (p.distance as number) ?? existing.distance;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(Set, existing);
      await this.recordChange(manager, user.id, "set", item.id, "update", existing.revision);
    } else {
      if (!(await this.workoutExerciseOwnedBy(manager, workoutExerciseId, user.id))) {
        rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
        return;
      }
      await manager.insert(Set, {
        id: item.id,
        workoutExerciseId,
        orderIndex: (p.orderIndex as number) ?? 0,
        weight: (p.weight as number) ?? null,
        reps: (p.reps as number) ?? null,
        rpe: (p.rpe as number) ?? null,
        isWarmup: Boolean(p.isWarmup),
        isDropset: Boolean(p.isDropset),
        isFailure: Boolean(p.isFailure),
        durationSeconds: (p.durationSeconds as number) ?? null,
        distance: (p.distance as number) ?? null,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "set", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "set", id: item.id, revision: item.revision });
  }

  // ─── Read APIs ────────────────────────────────────────────────────────────

  async getHistory(userId: string, query: WorkoutHistoryQueryDto) {
    const { from, to, exerciseId, search, page = 1, limit = 20 } = query;

    const qb = this.workoutsRepo.createQueryBuilder("w").where("w.userId = :userId", { userId }).andWhere("w.isDeleted = :deleted", { deleted: false });

    if (from) qb.andWhere("w.startedAt >= :from", { from: new Date(from) });
    if (to) qb.andWhere("w.startedAt <= :to", { to: new Date(to) });
    if (search) qb.andWhere("w.name ILIKE :search", { search: `%${search}%` });
    if (exerciseId) {
      qb.innerJoin("w.workoutExercises", "we", "we.exerciseId = :exerciseId AND we.isDeleted = :weDeleted", {
        exerciseId,
        weDeleted: false
      });
    }
    qb.orderBy("w.startedAt", "DESC");

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const workouts = await qb.getMany();
    const summaries = await this.toSummaries(workouts);

    return createPaginatedResponse(summaries, total, page, limit);
  }

  async getRecentWorkouts(userId: string, limit: number): Promise<WorkoutSummaryResponseDto[]> {
    const workouts = await this.workoutsRepo.find({
      where: { userId, isDeleted: false },
      order: { startedAt: "DESC" },
      take: limit
    });
    return this.toSummaries(workouts);
  }

  async getDetail(userId: string, id: string): Promise<WorkoutDetailResponseDto> {
    const workout = await this.workoutsRepo.findOne({ where: { id, userId, isDeleted: false } });
    if (!workout) {
      throw new NotFoundException("Workout not found");
    }
    const exercises = await this.workoutExercisesRepo.find({
      where: { workoutId: workout.id, isDeleted: false },
      order: { orderIndex: "ASC" }
    });
    const { withSets } = await this.toExerciseSummaries(exercises);
    return {
      id: workout.id,
      name: workout.name,
      notes: workout.notes,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      durationSeconds: workout.durationSeconds,
      revision: workout.revision,
      exercises: withSets
    };
  }

  async getExerciseHistory(userId: string, exerciseId: string, query: ExerciseHistoryQueryDto) {
    const { from, to, page = 1, limit = 20 } = query;

    const qb = this.workoutsRepo
      .createQueryBuilder("w")
      .innerJoin("w.workoutExercises", "we", "we.exerciseId = :exerciseId AND we.isDeleted = :weDeleted", {
        exerciseId,
        weDeleted: false
      })
      .where("w.userId = :userId", { userId })
      .andWhere("w.isDeleted = :deleted", { deleted: false });

    if (from) qb.andWhere("w.startedAt >= :from", { from: new Date(from) });
    if (to) qb.andWhere("w.startedAt <= :to", { to: new Date(to) });
    qb.orderBy("w.startedAt", "DESC");

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const workouts = await qb.getMany();

    const workoutIds = workouts.map((w) => w.id);
    const allExercises = workoutIds.length ? await this.workoutExercisesRepo.find({ where: { workoutId: In(workoutIds), isDeleted: false } }) : [];
    const matched = allExercises.filter((e) => e.exerciseId === exerciseId);
    const { withSets, byId } = await this.toExerciseSummaries(matched);

    const workoutById = new Map(workouts.map((w) => [w.id, w]));
    const entries: ExerciseHistoryEntryDto[] = byId
      .map(({ workoutId, index }) => {
        const workout = workoutById.get(workoutId);
        if (!workout) return null;
        return {
          workoutId,
          workoutName: workout.name,
          startedAt: workout.startedAt,
          endedAt: workout.endedAt,
          exercise: withSets[index]
        };
      })
      .filter((e): e is ExerciseHistoryEntryDto => e !== null);

    return createPaginatedResponse(entries, total, page, limit);
  }

  // ─── Ownership helpers ────────────────────────────────────────────────────

  private async userOwnsWorkoutExercise(manager: EntityManager, userId: string, we: WorkoutExercise): Promise<boolean> {
    if (!we.workoutId) return false;
    const workout = await manager.findOne(Workout, { where: { id: we.workoutId } });
    return !!workout && workout.userId === userId;
  }

  private async workoutExerciseOwnedBy(manager: EntityManager, workoutExerciseId: string, userId: string): Promise<boolean> {
    const we = await manager.findOne(WorkoutExercise, { where: { id: workoutExerciseId } });
    if (!we) return false;
    return this.userOwnsWorkoutExercise(manager, userId, we);
  }

  private async userOwnsSet(manager: EntityManager, userId: string, set: Set): Promise<boolean> {
    if (!set.workoutExerciseId) return false;
    return this.workoutExerciseOwnedBy(manager, set.workoutExerciseId, userId);
  }

  private async recordChange(manager: EntityManager, userId: string, entityType: string, entityId: string, operation: SyncOperation, revision: number): Promise<void> {
    await manager.insert(SyncChange, { userId, entityType, entityId, operation, revision });
  }

  // ─── Response mapping ─────────────────────────────────────────────────────

  private async toSummaries(workouts: Workout[]): Promise<WorkoutSummaryResponseDto[]> {
    if (workouts.length === 0) return [];
    const ids = workouts.map((w) => w.id);
    const exercises = ids.length ? await this.workoutExercisesRepo.find({ where: { workoutId: In(ids), isDeleted: false } }) : [];
    const byWorkout = new Map<string, WorkoutExercise[]>();
    for (const e of exercises) {
      const list = byWorkout.get(e.workoutId) || [];
      list.push(e);
      byWorkout.set(e.workoutId, list);
    }
    const exerciseIds = exercises.map((e) => e.id);
    const sets = exerciseIds.length ? await this.setsRepo.find({ where: { workoutExerciseId: In(exerciseIds), isDeleted: false } }) : [];
    const setsByExercise = new Map<string, Set[]>();
    for (const s of sets) {
      const list = setsByExercise.get(s.workoutExerciseId) || [];
      list.push(s);
      setsByExercise.set(s.workoutExerciseId, list);
    }

    return workouts.map((w) => {
      const we = byWorkout.get(w.id) || [];
      const setCount = we.reduce((acc, e) => acc + (setsByExercise.get(e.id)?.length ?? 0), 0);
      return {
        id: w.id,
        name: w.name,
        notes: w.notes,
        startedAt: w.startedAt,
        endedAt: w.endedAt,
        durationSeconds: w.durationSeconds,
        exerciseCount: we.length,
        setCount,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt
      };
    });
  }

  /**
   * Builds sorted [exercise block + nested sets] response summaries.
   * Returns the ordered summaries plus a parallel list of (workoutId, index)
   * so history entries can be paired back to their parent workout.
   */
  private async toExerciseSummaries(exercises: WorkoutExercise[]): Promise<{
    withSets: WorkoutExerciseSummaryDto[];
    byId: Array<{ workoutId: string; index: number }>;
  }> {
    if (exercises.length === 0) return { withSets: [], byId: [] };
    const ids = exercises.map((e) => e.id);
    const sets = ids.length ? await this.setsRepo.find({ where: { workoutExerciseId: In(ids), isDeleted: false } }) : [];
    const setsByExercise = new Map<string, Set[]>();
    for (const s of sets) {
      const list = setsByExercise.get(s.workoutExerciseId) || [];
      list.push(s);
      setsByExercise.set(s.workoutExerciseId, list);
    }

    const catalogIds: string[] = [];
    for (const id of [...exercises.map((e) => e.exerciseId).filter((x): x is string => Boolean(x))]) {
      if (!catalogIds.includes(id)) catalogIds.push(id);
    }
    const catalog = catalogIds.length ? await this.exercisesRepo.find({ where: { id: In(catalogIds) } }) : [];
    const catalogById = new Map(catalog.map((c) => [c.id, c]));

    const withSets: WorkoutExerciseSummaryDto[] = [];
    const byId: Array<{ workoutId: string; index: number }> = [];
    for (const e of exercises) {
      withSets.push({
        id: e.id,
        exerciseId: e.exerciseId,
        name: e.name,
        orderIndex: e.orderIndex,
        notes: e.notes,
        restSeconds: e.restSeconds,
        exercise: e.exerciseId ? this.toExerciseMeta(catalogById.get(e.exerciseId)) : undefined,
        sets: this.toSetDtos(setsByExercise.get(e.id) || [])
      });
      byId.push({ workoutId: e.workoutId, index: withSets.length - 1 });
    }
    return { withSets, byId };
  }

  private toExerciseMeta(exercise: Exercise | undefined): { id: string; title: string; slug: string } | undefined {
    if (!exercise) return undefined;
    return { id: exercise.id, title: exercise.title, slug: exercise.slug };
  }

  private toSetDtos(sets: Set[]): SetResponseDto[] {
    return [...sets]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((s) => ({
        id: s.id,
        orderIndex: s.orderIndex,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        isWarmup: s.isWarmup,
        isDropset: s.isDropset,
        isFailure: s.isFailure,
        durationSeconds: s.durationSeconds,
        distance: s.distance
      }));
  }
}
