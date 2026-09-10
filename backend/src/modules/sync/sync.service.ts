import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, DataSource, EntityManager, MoreThan } from "typeorm";
import { Workout } from "../workouts/entities/workout.entity";
import { WorkoutExercise } from "../workouts/entities/workout-exercise.entity";
import { Set } from "../workouts/entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { UserTemplate } from "../workouts/entities/user-template.entity";
import { UserTemplateExercise } from "../workouts/entities/user-template-exercise.entity";
import { UserTemplateSet } from "../workouts/entities/user-template-set.entity";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { User } from "../users/entities/user.entity";
import { SyncWorkoutDto } from "./dto/sync-workout.dto";
import { SyncBatchRequestDto, SyncChangeItemDto } from "./dto/sync-batch.dto";
import { resolveWinner } from "./sync-conflict.util";

type Accepted = { entityType: string; id: string; revision: number };
type Rejected = { entityType: string; id: string; reason: string; serverRevision?: number };
type Conflict = {
  entityType: string;
  id: string;
  clientRevision: number;
  serverRevision: number;
  resolvedWith: "server" | "client" | "merged";
  winningPayload?: Record<string, unknown>;
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(Workout) private workoutsRepo: Repository<Workout>,
    @InjectRepository(WorkoutExercise) private workoutExercisesRepo: Repository<WorkoutExercise>,
    @InjectRepository(Set) private setsRepo: Repository<Set>,
    @InjectRepository(UserTemplate) private templatesRepo: Repository<UserTemplate>,
    @InjectRepository(UserTemplateExercise) private templateExercisesRepo: Repository<UserTemplateExercise>,
    @InjectRepository(UserTemplateSet) private templateSetsRepo: Repository<UserTemplateSet>,
    @InjectRepository(UserSyncState) private syncStateRepo: Repository<UserSyncState>,
    private dataSource: DataSource
  ) {}

  /** Legacy full-tree upsert — kept for backward compatibility. */
  async syncWorkout(dto: SyncWorkoutDto, user: User): Promise<{ success: boolean; workoutId: string }> {
    const { workout } = dto;
    const changes = {
      workouts: [
        {
          op: "upsert" as const,
          id: workout.id,
          revision: 1,
          localUpdatedAt: workout.endedAt || workout.startedAt,
          payload: {
            id: workout.id,
            name: workout.name ?? null,
            notes: workout.notes ?? null,
            startedAt: workout.startedAt,
            endedAt: workout.endedAt ?? null,
            durationSeconds: workout.durationSeconds ?? null
          }
        }
      ],
      workoutExercises: workout.exercises.map((ex) => ({
        op: "upsert" as const,
        id: ex.id,
        revision: 1,
        localUpdatedAt: workout.endedAt || workout.startedAt,
        payload: {
          id: ex.id,
          workoutId: workout.id,
          exerciseId: ex.exerciseId,
          name: ex.name ?? null,
          orderIndex: ex.orderIndex,
          notes: ex.notes ?? null,
          restSeconds: ex.restSeconds ?? null
        }
      })),
      sets: workout.exercises.flatMap((ex) =>
        ex.sets.map((s) => ({
          op: "upsert" as const,
          id: s.id,
          revision: 1,
          localUpdatedAt: workout.endedAt || workout.startedAt,
          payload: {
            id: s.id,
            workoutExerciseId: ex.id,
            orderIndex: s.orderIndex ?? 0,
            weight: s.weight ?? null,
            reps: s.reps ?? null,
            rpe: s.rpe ?? null,
            isWarmup: s.isWarmup ?? false,
            isDropset: s.isDropset ?? false,
            isFailure: s.isFailure ?? false,
            durationSeconds: s.durationSeconds ?? null,
            distance: s.distance ?? null
          }
        }))
      ),
      templates: [],
      templateExercises: [],
      templateSets: []
    };

    await this.syncBatch(
      {
        lastSyncToken: null,
        clientId: "00000000-0000-4000-8000-000000000000",
        changes
      },
      user
    );
    return { success: true, workoutId: workout.id };
  }

  async syncBatch(dto: SyncBatchRequestDto, user: User) {
    const accepted: Accepted[] = [];
    const rejected: Rejected[] = [];
    const conflicts: Conflict[] = [];
    const serverTime = new Date();

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const manager = qr.manager;
      const changes = dto.changes || {};

      for (const item of changes.workouts || []) {
        await this.applyWorkoutChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.workoutExercises || []) {
        await this.applyWorkoutExerciseChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.sets || []) {
        await this.applySetChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templates || []) {
        await this.applyTemplateChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templateExercises || []) {
        await this.applyTemplateExerciseChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templateSets || []) {
        await this.applyTemplateSetChange(manager, user, item, accepted, rejected, conflicts);
      }

      const serverChanges = await this.collectServerChanges(manager, user.id, dto.lastSyncToken ?? null);

      let syncState = await manager.findOne(UserSyncState, { where: { userId: user.id } });
      const syncToken = serverTime.toISOString();
      if (!syncState) {
        syncState = manager.create(UserSyncState, {
          userId: user.id,
          syncToken,
          clientId: dto.clientId
        });
      } else {
        syncState.syncToken = syncToken;
        syncState.clientId = dto.clientId;
      }
      await manager.save(UserSyncState, syncState);

      await qr.commitTransaction();

      return {
        syncToken,
        serverTime: syncToken,
        accepted,
        rejected,
        serverChanges,
        conflicts
      };
    } catch (e) {
      await qr.rollbackTransaction();
      this.logger.error("Batch sync failed", e instanceof Error ? e.stack : e);
      throw e;
    } finally {
      await qr.release();
    }
  }

  private async applyWorkoutChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    conflicts: Conflict[]
  ) {
    const existing = await manager.findOne(Workout, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "workout", id: item.id, reason: "ownership" });
      return;
    }

    if (item.op === "delete") {
      if (!existing) {
        accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
        return;
      }
      const winner = resolveWinner(item.localUpdatedAt, existing.updatedAt, item.revision, existing.revision ?? 1);
      if (winner === "server" && !(existing.isDeleted || existing.deletedAt)) {
        conflicts.push({
          entityType: "workout",
          id: item.id,
          clientRevision: item.revision,
          serverRevision: existing.revision ?? 1,
          resolvedWith: "server"
        });
        accepted.push({ entityType: "workout", id: item.id, revision: existing.revision ?? 1 });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.localUpdatedAt);
      existing.revision = item.revision;
      await manager.save(Workout, existing);
      accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
      return;
    }

    const p = item.payload || {};
    if (existing) {
      const winner = resolveWinner(item.localUpdatedAt, existing.updatedAt, item.revision, existing.revision ?? 1);
      if (winner === "server" && item.revision <= (existing.revision ?? 1)) {
        conflicts.push({
          entityType: "workout",
          id: item.id,
          clientRevision: item.revision,
          serverRevision: existing.revision ?? 1,
          resolvedWith: "server"
        });
        accepted.push({ entityType: "workout", id: item.id, revision: existing.revision ?? 1 });
        return;
      }
      if (winner === "client" && item.revision < (existing.revision ?? 1)) {
        // same timestamp but lower rev — still accept if LWW chose client via time
      }
      existing.name = (p.name as string) ?? existing.name;
      existing.notes = (p.notes as string) ?? existing.notes;
      if (p.startedAt) existing.startedAt = new Date(p.startedAt as string);
      existing.endedAt = p.endedAt ? new Date(p.endedAt as string) : existing.endedAt;
      existing.durationSeconds = (p.durationSeconds as number) ?? existing.durationSeconds;
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(Workout, existing);
    } else {
      await manager.insert(Workout, {
        id: item.id,
        userId: user.id,
        name: (p.name as string) ?? null,
        notes: (p.notes as string) ?? null,
        startedAt: new Date((p.startedAt as string) || item.localUpdatedAt),
        endedAt: p.endedAt ? new Date(p.endedAt as string) : null,
        durationSeconds: (p.durationSeconds as number) ?? null,
        revision: item.revision
      });
    }
    accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
  }

  private async applyWorkoutExerciseChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    conflicts: Conflict[]
  ) {
    const p = item.payload || {};
    const workoutId = (p.workoutId as string) || null;
    if (workoutId) {
      const workout = await manager.findOne(Workout, { where: { id: workoutId } });
      if (workout && workout.userId !== user.id) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
        return;
      }
    }

    const existing = await manager.findOne(WorkoutExercise, { where: { id: item.id } });
    if (item.op === "delete") {
      if (!existing) {
        accepted.push({ entityType: "workoutExercise", id: item.id, revision: item.revision });
        return;
      }
      const parent = await manager.findOne(Workout, { where: { id: existing.workoutId } });
      if (parent && parent.userId !== user.id) {
        rejected.push({ entityType: "workoutExercise", id: item.id, reason: "ownership" });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.localUpdatedAt);
      existing.revision = item.revision;
      await manager.save(WorkoutExercise, existing);
      accepted.push({ entityType: "workoutExercise", id: item.id, revision: item.revision });
      return;
    }

    let exerciseId = (p.exerciseId as string) || null;
    const name = (p.name as string) || null;
    if (!exerciseId && name) {
      exerciseId = await this.resolveExerciseId(manager, name);
    }
    if (!exerciseId) {
      rejected.push({ entityType: "workoutExercise", id: item.id, reason: "missing_exercise" });
      return;
    }
    if (!workoutId) {
      rejected.push({ entityType: "workoutExercise", id: item.id, reason: "missing_workout" });
      return;
    }

    if (existing) {
      const winner = resolveWinner(item.localUpdatedAt, existing.updatedAt, item.revision, existing.revision ?? 1);
      if (winner === "server" && item.revision <= (existing.revision ?? 1)) {
        conflicts.push({
          entityType: "workoutExercise",
          id: item.id,
          clientRevision: item.revision,
          serverRevision: existing.revision ?? 1,
          resolvedWith: "server"
        });
        accepted.push({ entityType: "workoutExercise", id: item.id, revision: existing.revision ?? 1 });
        return;
      }
      existing.workoutId = workoutId;
      existing.exerciseId = exerciseId;
      existing.name = name;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.notes = (p.notes as string) ?? existing.notes;
      existing.restSeconds = (p.restSeconds as number) ?? existing.restSeconds;
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(WorkoutExercise, existing);
    } else {
      await manager.insert(WorkoutExercise, {
        id: item.id,
        workoutId,
        exerciseId,
        name,
        orderIndex: (p.orderIndex as number) ?? 0,
        notes: (p.notes as string) ?? null,
        restSeconds: (p.restSeconds as number) ?? null,
        revision: item.revision
      });
    }
    accepted.push({ entityType: "workoutExercise", id: item.id, revision: item.revision });
  }

  private async applySetChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    conflicts: Conflict[]
  ) {
    const p = item.payload || {};
    const existing = await manager.findOne(Set, { where: { id: item.id } });

    if (item.op === "delete") {
      if (!existing) {
        accepted.push({ entityType: "set", id: item.id, revision: item.revision });
        return;
      }
      if (!(await this.userOwnsSet(manager, user.id, existing))) {
        rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.localUpdatedAt);
      existing.revision = item.revision;
      await manager.save(Set, existing);
      accepted.push({ entityType: "set", id: item.id, revision: item.revision });
      return;
    }

    const workoutExerciseId = p.workoutExerciseId as string;
    if (!workoutExerciseId) {
      rejected.push({ entityType: "set", id: item.id, reason: "missing_exercise" });
      return;
    }

    const we = await manager.findOne(WorkoutExercise, { where: { id: workoutExerciseId } });
    if (we) {
      const workout = await manager.findOne(Workout, { where: { id: we.workoutId } });
      if (workout && workout.userId !== user.id) {
        rejected.push({ entityType: "set", id: item.id, reason: "ownership" });
        return;
      }
    }

    if (existing) {
      const winner = resolveWinner(item.localUpdatedAt, existing.updatedAt, item.revision, existing.revision ?? 1);
      if (winner === "server" && item.revision <= (existing.revision ?? 1)) {
        conflicts.push({
          entityType: "set",
          id: item.id,
          clientRevision: item.revision,
          serverRevision: existing.revision ?? 1,
          resolvedWith: "server"
        });
        accepted.push({ entityType: "set", id: item.id, revision: existing.revision ?? 1 });
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
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(Set, existing);
    } else {
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
        revision: item.revision
      });
    }
    accepted.push({ entityType: "set", id: item.id, revision: item.revision });
  }

  private async applyTemplateChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    _conflicts: Conflict[]
  ) {
    const existing = await manager.findOne(UserTemplate, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "template", id: item.id, reason: "ownership" });
      return;
    }
    if (item.op === "delete") {
      if (existing) {
        existing.isDeleted = true;
        existing.deletedAt = new Date(item.localUpdatedAt);
        existing.revision = item.revision;
        await manager.save(UserTemplate, existing);
      }
      accepted.push({ entityType: "template", id: item.id, revision: item.revision });
      return;
    }
    const p = item.payload || {};
    if (existing) {
      const winner = resolveWinner(item.localUpdatedAt, existing.updatedAt, item.revision, existing.revision ?? 1);
      if (winner === "server" && item.revision <= (existing.revision ?? 1)) {
        accepted.push({ entityType: "template", id: item.id, revision: existing.revision ?? 1 });
        return;
      }
      existing.name = (p.name as string) || existing.name;
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(UserTemplate, existing);
    } else {
      await manager.insert(UserTemplate, {
        id: item.id,
        userId: user.id,
        name: (p.name as string) || "Template",
        revision: item.revision
      });
    }
    accepted.push({ entityType: "template", id: item.id, revision: item.revision });
  }

  private async applyTemplateExerciseChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    _conflicts: Conflict[]
  ) {
    const p = item.payload || {};
    const existing = await manager.findOne(UserTemplateExercise, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
      return;
    }
    if (item.op === "delete") {
      if (existing) {
        existing.isDeleted = true;
        existing.deletedAt = new Date(item.localUpdatedAt);
        existing.revision = item.revision;
        await manager.save(UserTemplateExercise, existing);
      }
      accepted.push({ entityType: "templateExercise", id: item.id, revision: item.revision });
      return;
    }
    const templateId = p.templateId as string;
    if (!templateId) {
      rejected.push({ entityType: "templateExercise", id: item.id, reason: "missing_template" });
      return;
    }
    if (existing) {
      existing.templateId = templateId;
      existing.name = (p.name as string) || existing.name;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(UserTemplateExercise, existing);
    } else {
      await manager.insert(UserTemplateExercise, {
        id: item.id,
        templateId,
        userId: user.id,
        name: (p.name as string) || "Exercise",
        orderIndex: (p.orderIndex as number) ?? 0,
        revision: item.revision
      });
    }
    accepted.push({ entityType: "templateExercise", id: item.id, revision: item.revision });
  }

  private async applyTemplateSetChange(
    manager: EntityManager,
    user: User,
    item: SyncChangeItemDto,
    accepted: Accepted[],
    rejected: Rejected[],
    _conflicts: Conflict[]
  ) {
    const p = item.payload || {};
    const existing = await manager.findOne(UserTemplateSet, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
      return;
    }
    if (item.op === "delete") {
      if (existing) {
        existing.isDeleted = true;
        existing.deletedAt = new Date(item.localUpdatedAt);
        existing.revision = item.revision;
        await manager.save(UserTemplateSet, existing);
      }
      accepted.push({ entityType: "templateSet", id: item.id, revision: item.revision });
      return;
    }
    const templateExerciseId = p.templateExerciseId as string;
    if (!templateExerciseId) {
      rejected.push({ entityType: "templateSet", id: item.id, reason: "missing_exercise" });
      return;
    }
    if (existing) {
      existing.templateExerciseId = templateExerciseId;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.weight = (p.weight as number) ?? null;
      existing.reps = (p.reps as number) ?? null;
      existing.isWarmup = Boolean(p.isWarmup);
      existing.isDropset = Boolean(p.isDropset);
      existing.isFailure = Boolean(p.isFailure);
      existing.revision = item.revision;
      existing.isDeleted = false;
      existing.deletedAt = null;
      await manager.save(UserTemplateSet, existing);
    } else {
      await manager.insert(UserTemplateSet, {
        id: item.id,
        templateExerciseId,
        userId: user.id,
        orderIndex: (p.orderIndex as number) ?? 0,
        weight: (p.weight as number) ?? null,
        reps: (p.reps as number) ?? null,
        isWarmup: Boolean(p.isWarmup),
        isDropset: Boolean(p.isDropset),
        isFailure: Boolean(p.isFailure),
        revision: item.revision
      });
    }
    accepted.push({ entityType: "templateSet", id: item.id, revision: item.revision });
  }

  private async resolveExerciseId(manager: EntityManager, name: string): Promise<string> {
    let exercise = await manager.findOne(Exercise, { where: { title: name } });
    if (!exercise) {
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const slug = `${baseSlug}-${Date.now().toString().slice(-6)}`;
      exercise = manager.create(Exercise, {
        title: name,
        slug,
        description: "Custom exercise created from app"
      });
      exercise = await manager.save(Exercise, exercise);
    }
    return exercise.id;
  }

  private async userOwnsSet(manager: EntityManager, userId: string, set: Set): Promise<boolean> {
    const we = await manager.findOne(WorkoutExercise, { where: { id: set.workoutExerciseId } });
    if (!we) return false;
    const workout = await manager.findOne(Workout, { where: { id: we.workoutId } });
    return !!workout && workout.userId === userId;
  }

  private async collectServerChanges(manager: EntityManager, userId: string, lastSyncToken: string | null) {
    const since = lastSyncToken ? new Date(lastSyncToken) : new Date(0);
    const empty = {
      workouts: [] as SyncChangeItemDto[],
      workoutExercises: [] as SyncChangeItemDto[],
      sets: [] as SyncChangeItemDto[],
      templates: [] as SyncChangeItemDto[],
      templateExercises: [] as SyncChangeItemDto[],
      templateSets: [] as SyncChangeItemDto[]
    };

    const workouts = await manager.find(Workout, {
      where: { userId, updatedAt: MoreThan(since) }
    });
    empty.workouts = workouts.map((w) => ({
      op: w.isDeleted || w.deletedAt ? ("delete" as const) : ("upsert" as const),
      id: w.id,
      revision: w.revision ?? 1,
      localUpdatedAt: w.updatedAt.toISOString(),
      payload: w.isDeleted || w.deletedAt
        ? null
        : {
            id: w.id,
            name: w.name,
            notes: w.notes,
            startedAt: w.startedAt.toISOString(),
            endedAt: w.endedAt ? w.endedAt.toISOString() : null,
            durationSeconds: w.durationSeconds,
            revision: w.revision,
            serverUpdatedAt: w.updatedAt.toISOString(),
            deletedAt: null
          }
    }));

    const workoutIds = (
      await manager.find(Workout, { where: { userId }, select: ["id"] })
    ).map((w) => w.id);

    if (workoutIds.length > 0) {
      const exercises = await manager
        .createQueryBuilder(WorkoutExercise, "we")
        .where("we.workout_id IN (:...ids)", { ids: workoutIds })
        .andWhere("we.updated_at > :since", { since })
        .getMany();

      empty.workoutExercises = exercises.map((ex) => ({
        op: ex.isDeleted || ex.deletedAt ? ("delete" as const) : ("upsert" as const),
        id: ex.id,
        revision: ex.revision ?? 1,
        localUpdatedAt: ex.updatedAt.toISOString(),
        payload: ex.isDeleted || ex.deletedAt
          ? null
          : {
              id: ex.id,
              workoutId: ex.workoutId,
              exerciseId: ex.exerciseId,
              name: ex.name,
              orderIndex: ex.orderIndex,
              notes: ex.notes,
              restSeconds: ex.restSeconds,
              revision: ex.revision,
              serverUpdatedAt: ex.updatedAt.toISOString(),
              deletedAt: null
            }
      }));

      const exerciseIds = exercises.map((e) => e.id);
      const allExerciseIds = (
        await manager
          .createQueryBuilder(WorkoutExercise, "we")
          .select("we.id")
          .where("we.workout_id IN (:...ids)", { ids: workoutIds })
          .getMany()
      ).map((e) => e.id);

      if (allExerciseIds.length > 0) {
        const sets = await manager
          .createQueryBuilder(Set, "s")
          .where("s.workout_exercise_id IN (:...ids)", { ids: allExerciseIds })
          .andWhere("s.updated_at > :since", { since })
          .getMany();

        empty.sets = sets.map((s) => ({
          op: s.isDeleted || s.deletedAt ? ("delete" as const) : ("upsert" as const),
          id: s.id,
          revision: s.revision ?? 1,
          localUpdatedAt: s.updatedAt.toISOString(),
          payload: s.isDeleted || s.deletedAt
            ? null
            : {
                id: s.id,
                workoutExerciseId: s.workoutExerciseId,
                orderIndex: s.orderIndex,
                weight: s.weight,
                reps: s.reps,
                rpe: s.rpe,
                isWarmup: s.isWarmup,
                isDropset: s.isDropset,
                isFailure: s.isFailure,
                durationSeconds: s.durationSeconds,
                distance: s.distance,
                revision: s.revision,
                serverUpdatedAt: s.updatedAt.toISOString(),
                deletedAt: null
              }
        }));
      }
    }

    const templates = await manager.find(UserTemplate, {
      where: { userId, updatedAt: MoreThan(since) }
    });
    empty.templates = templates.map((t) => ({
      op: t.isDeleted || t.deletedAt ? ("delete" as const) : ("upsert" as const),
      id: t.id,
      revision: t.revision ?? 1,
      localUpdatedAt: t.updatedAt.toISOString(),
      payload: t.isDeleted || t.deletedAt
        ? null
        : {
            id: t.id,
            name: t.name,
            createdAt: t.createdAt.toISOString(),
            revision: t.revision,
            serverUpdatedAt: t.updatedAt.toISOString(),
            deletedAt: null
          }
    }));

    const templateExercises = await manager.find(UserTemplateExercise, {
      where: { userId, updatedAt: MoreThan(since) }
    });
    empty.templateExercises = templateExercises.map((ex) => ({
      op: ex.isDeleted || ex.deletedAt ? ("delete" as const) : ("upsert" as const),
      id: ex.id,
      revision: ex.revision ?? 1,
      localUpdatedAt: ex.updatedAt.toISOString(),
      payload: ex.isDeleted || ex.deletedAt
        ? null
        : {
            id: ex.id,
            templateId: ex.templateId,
            name: ex.name,
            orderIndex: ex.orderIndex,
            revision: ex.revision,
            serverUpdatedAt: ex.updatedAt.toISOString(),
            deletedAt: null
          }
    }));

    const templateSets = await manager.find(UserTemplateSet, {
      where: { userId, updatedAt: MoreThan(since) }
    });
    empty.templateSets = templateSets.map((s) => ({
      op: s.isDeleted || s.deletedAt ? ("delete" as const) : ("upsert" as const),
      id: s.id,
      revision: s.revision ?? 1,
      localUpdatedAt: s.updatedAt.toISOString(),
      payload: s.isDeleted || s.deletedAt
        ? null
        : {
            id: s.id,
            templateExerciseId: s.templateExerciseId,
            orderIndex: s.orderIndex,
            weight: s.weight,
            reps: s.reps,
            isWarmup: s.isWarmup,
            isDropset: s.isDropset,
            isFailure: s.isFailure,
            revision: s.revision,
            serverUpdatedAt: s.updatedAt.toISOString(),
            deletedAt: null
          }
    }));

    return empty;
  }
}
