import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, DataSource, EntityManager, In, MoreThan } from "typeorm";
import { Workout } from "../workouts/entities/workout.entity";
import { WorkoutExercise } from "../workouts/entities/workout-exercise.entity";
import { Set } from "../workouts/entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { UserTemplate } from "../workouts/entities/user-template.entity";
import { UserTemplateExercise } from "../workouts/entities/user-template-exercise.entity";
import { UserTemplateSet } from "../workouts/entities/user-template-set.entity";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { SyncChange, SyncOperation } from "./entities/sync-change.entity";
import { User } from "../users/entities/user.entity";
import { SyncWorkoutDto } from "./dto/sync-workout.dto";
import { SyncBatchRequestDto, SyncChangeItemDto } from "./dto/sync-batch.dto";
import { resolveWinner, isIdempotentReplay } from "./sync-conflict.util";

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

function emptyBatch(): {
  workouts: SyncChangeItemDto[];
  workoutExercises: SyncChangeItemDto[];
  sets: SyncChangeItemDto[];
  templates: SyncChangeItemDto[];
  templateExercises: SyncChangeItemDto[];
  templateSets: SyncChangeItemDto[];
} {
  return {
    workouts: [],
    workoutExercises: [],
    sets: [],
    templates: [],
    templateExercises: [],
    templateSets: []
  };
}

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
    @InjectRepository(SyncChange) private syncChangesRepo: Repository<SyncChange>,
    private dataSource: DataSource
  ) {}

  // ─── Legacy endpoint (kept for backward compat) ──────────────────────────

  async syncWorkout(dto: SyncWorkoutDto, user: User): Promise<{ success: boolean; workoutId: string }> {
    const { workout } = dto;
    const changes = {
      workouts: [
        {
          op: "upsert" as const,
          id: workout.id,
          revision: 1,
          clientUpdatedAt: workout.endedAt || workout.startedAt,
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
        clientUpdatedAt: workout.endedAt || workout.startedAt,
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
          clientUpdatedAt: workout.endedAt || workout.startedAt,
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
        lastSyncRevision: 0,
        clientId: "00000000-0000-4000-8000-000000000000",
        changes
      },
      user
    );
    return { success: true, workoutId: workout.id };
  }

  // ─── Primary sync entry point ────────────────────────────────────────────

  async syncBatch(dto: SyncBatchRequestDto, user: User) {
    const accepted: Accepted[] = [];
    const rejected: Rejected[] = [];
    const conflicts: Conflict[] = [];

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

      const lastSyncRevision = dto.lastSyncRevision ?? 0;
      const { serverChanges, nextRevision } = await this.collectServerChanges(manager, user.id, lastSyncRevision);

      let syncState = await manager.findOne(UserSyncState, { where: { userId: user.id } });
      if (!syncState) {
        syncState = manager.create(UserSyncState, {
          userId: user.id,
          syncRevision: nextRevision,
          clientId: dto.clientId
        });
      } else {
        syncState.syncRevision = nextRevision;
        syncState.clientId = dto.clientId;
      }
      await manager.save(UserSyncState, syncState);

      await qr.commitTransaction();

      return {
        syncRevision: nextRevision,
        serverTime: new Date().toISOString(),
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

  // ─── Push: entity change handlers ────────────────────────────────────────

  private async applyWorkoutChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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
    } else {
      await manager.insert(Workout, {
        id: item.id,
        userId: user.id,
        name: (p.name as string) ?? null,
        notes: (p.notes as string) ?? null,
        startedAt: new Date((p.startedAt as string) || item.clientUpdatedAt),
        endedAt: p.endedAt ? new Date(p.endedAt as string) : null,
        durationSeconds: (p.durationSeconds as number) ?? null,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "workout", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "workout", id: item.id, revision: item.revision });
  }

  private async applyWorkoutExerciseChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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
      exerciseId = await this.resolveExerciseId(manager, name);
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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

  private async applySetChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
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

  private async applyTemplateChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
    const existing = await manager.findOne(UserTemplate, { where: { id: item.id } });
    if (existing && existing.userId !== user.id) {
      rejected.push({ entityType: "template", id: item.id, reason: "ownership" });
      return;
    }
    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "template", item.id, "delete", item.revision);
        accepted.push({ entityType: "template", id: item.id, revision: item.revision });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "template",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "template", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplate, existing);
      await this.recordChange(manager, user.id, "template", item.id, "delete", existing.revision);
      accepted.push({ entityType: "template", id: item.id, revision: existing.revision });
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "template",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "template", id: item.id, revision: serverRevision });
        return;
      }
      existing.name = (p.name as string) || existing.name;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplate, existing);
      await this.recordChange(manager, user.id, "template", item.id, "update", existing.revision);
    } else {
      await manager.insert(UserTemplate, {
        id: item.id,
        userId: user.id,
        name: (p.name as string) || "Template",
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "template", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "template", id: item.id, revision: item.revision });
  }

  private async applyTemplateExerciseChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
    const p = item.payload || {};
    const existing = await manager.findOne(UserTemplateExercise, { where: { id: item.id } });

    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "templateExercise", item.id, "delete", item.revision);
        accepted.push({ entityType: "templateExercise", id: item.id, revision: item.revision });
        return;
      }
      if (!(await this.userOwnsTemplateExercise(manager, user.id, existing))) {
        rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "templateExercise",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "templateExercise", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplateExercise, existing);
      await this.recordChange(manager, user.id, "templateExercise", item.id, "delete", existing.revision);
      accepted.push({ entityType: "templateExercise", id: item.id, revision: existing.revision });
      return;
    }

    const templateId = p.templateId as string;
    if (!templateId) {
      rejected.push({ entityType: "templateExercise", id: item.id, reason: "missing_template" });
      return;
    }

    if (existing) {
      if (!(await this.userOwnsTemplateExercise(manager, user.id, existing))) {
        rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
        return;
      }
      if (existing.templateId !== templateId) {
        const target = await manager.findOne(UserTemplate, { where: { id: templateId } });
        if (!target || target.userId !== user.id) {
          rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "templateExercise",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "templateExercise", id: item.id, revision: serverRevision });
        return;
      }
      existing.templateId = templateId;
      existing.name = (p.name as string) || existing.name;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplateExercise, existing);
      await this.recordChange(manager, user.id, "templateExercise", item.id, "update", existing.revision);
    } else {
      const parent = await manager.findOne(UserTemplate, { where: { id: templateId } });
      if (!parent || parent.userId !== user.id) {
        rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
        return;
      }
      await manager.insert(UserTemplateExercise, {
        id: item.id,
        templateId,
        userId: user.id,
        name: (p.name as string) || "Exercise",
        orderIndex: (p.orderIndex as number) ?? 0,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "templateExercise", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "templateExercise", id: item.id, revision: item.revision });
  }

  private async applyTemplateSetChange(manager: EntityManager, user: User, item: SyncChangeItemDto, accepted: Accepted[], rejected: Rejected[], conflicts: Conflict[]) {
    const p = item.payload || {};
    const existing = await manager.findOne(UserTemplateSet, { where: { id: item.id } });

    if (item.op === "delete") {
      if (!existing) {
        await this.recordChange(manager, user.id, "templateSet", item.id, "delete", item.revision);
        accepted.push({ entityType: "templateSet", id: item.id, revision: item.revision });
        return;
      }
      if (!(await this.userOwnsTemplateSet(manager, user.id, existing))) {
        rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
        return;
      }
      const serverRevision = existing.revision ?? 1;
      const existingTime = existing.clientUpdatedAt ?? existing.updatedAt;
      const winner = resolveWinner(item.clientUpdatedAt, existingTime, item.revision, serverRevision, {
        clientDeleted: true,
        serverDeleted: Boolean(existing.isDeleted || existing.deletedAt)
      });
      if (winner === "server") {
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "templateSet",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "templateSet", id: item.id, revision: serverRevision });
        return;
      }
      existing.isDeleted = true;
      existing.deletedAt = new Date(item.clientUpdatedAt);
      existing.deletedBy = user.id;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplateSet, existing);
      await this.recordChange(manager, user.id, "templateSet", item.id, "delete", existing.revision);
      accepted.push({ entityType: "templateSet", id: item.id, revision: existing.revision });
      return;
    }

    const templateExerciseId = p.templateExerciseId as string;
    if (!templateExerciseId) {
      rejected.push({ entityType: "templateSet", id: item.id, reason: "missing_exercise" });
      return;
    }

    if (existing) {
      if (!(await this.userOwnsTemplateSet(manager, user.id, existing))) {
        rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
        return;
      }
      if (existing.templateExerciseId !== templateExerciseId) {
        if (!(await this.templateExerciseOwnedBy(manager, templateExerciseId, user.id))) {
          rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
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
        if (!isIdempotentReplay(serverRevision, item.revision)) {
          conflicts.push({
            entityType: "templateSet",
            id: item.id,
            clientRevision: item.revision,
            serverRevision,
            resolvedWith: "server"
          });
        }
        accepted.push({ entityType: "templateSet", id: item.id, revision: serverRevision });
        return;
      }
      existing.templateExerciseId = templateExerciseId;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.weight = (p.weight as number) ?? null;
      existing.reps = (p.reps as number) ?? null;
      existing.isWarmup = Boolean(p.isWarmup);
      existing.isDropset = Boolean(p.isDropset);
      existing.isFailure = Boolean(p.isFailure);
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(UserTemplateSet, existing);
      await this.recordChange(manager, user.id, "templateSet", item.id, "update", existing.revision);
    } else {
      if (!(await this.templateExerciseOwnedBy(manager, templateExerciseId, user.id))) {
        rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
        return;
      }
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
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "templateSet", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "templateSet", id: item.id, revision: item.revision });
  }

  // ─── Helpers: push ───────────────────────────────────────────────────────

  private async recordChange(manager: EntityManager, userId: string, entityType: string, entityId: string, operation: SyncOperation, revision: number): Promise<void> {
    await manager.insert(SyncChange, { userId, entityType, entityId, operation, revision });
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

  private async userOwnsTemplateExercise(manager: EntityManager, userId: string, te: UserTemplateExercise): Promise<boolean> {
    if (!te.templateId) return false;
    const template = await manager.findOne(UserTemplate, { where: { id: te.templateId } });
    return !!template && template.userId === userId;
  }

  private async templateExerciseOwnedBy(manager: EntityManager, templateExerciseId: string, userId: string): Promise<boolean> {
    const te = await manager.findOne(UserTemplateExercise, { where: { id: templateExerciseId } });
    if (!te) return false;
    return this.userOwnsTemplateExercise(manager, userId, te);
  }

  private async userOwnsTemplateSet(manager: EntityManager, userId: string, ts: UserTemplateSet): Promise<boolean> {
    if (!ts.templateExerciseId) return false;
    return this.templateExerciseOwnedBy(manager, ts.templateExerciseId, userId);
  }

  // ─── Pull: cursor-based server changes ───────────────────────────────────

  /**
   * Cursor → changes after cursor → records/tombstones → new cursor.
   *
   * When `lastSyncRevision` is 0 the client has never synced; we load every
   * entity for the user so the device can bootstrap. For incremental pulls
   * we read from `sync_changes` (append-only log), deduplicate by entity
   * (keeping only the latest mutation per entity), and batch-load current
   * entity states. Tombstones are returned for soft-deleted entities.
   */
  private async collectServerChanges(
    manager: EntityManager,
    userId: string,
    lastSyncRevision: number
  ): Promise<{ serverChanges: ReturnType<typeof emptyBatch>; nextRevision: number }> {
    if (lastSyncRevision === 0) {
      return this.loadAllEntities(manager, userId);
    }

    const changeRows = await manager.find(SyncChange, {
      where: { userId, id: MoreThan(lastSyncRevision) },
      order: { id: "ASC" }
    });

    if (changeRows.length === 0) {
      return { serverChanges: emptyBatch(), nextRevision: lastSyncRevision };
    }

    const nextRevision = changeRows[changeRows.length - 1].id;

    // Deduplicate: keep only the latest change per (entityType, entityId).
    const latestByEntity = new Map<string, SyncChange>();
    for (const row of changeRows) {
      const key = `${row.entityType}:${row.entityId}`;
      latestByEntity.set(key, row);
    }

    const batch = emptyBatch();
    const byType = new Map<string, SyncChange[]>();
    for (const change of latestByEntity.values()) {
      const list = byType.get(change.entityType) || [];
      list.push(change);
      byType.set(change.entityType, list);
    }

    // Workouts
    const workoutChanges = byType.get("workout") || [];
    if (workoutChanges.length > 0) {
      const ids = workoutChanges.map((c) => c.entityId);
      const entities = await manager.find(Workout, { where: { id: In(ids) } });
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of workoutChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.workouts.push(this.toWorkoutItem(entity));
        } else {
          // Tombstone: entity was hard-deleted by another path.
          batch.workouts.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    // Workout Exercises
    const weChanges = byType.get("workoutExercise") || [];
    if (weChanges.length > 0) {
      const ids = weChanges.map((c) => c.entityId);
      const entities = await manager
        .createQueryBuilder(WorkoutExercise, "we")
        .innerJoin("we.workout", "w")
        .where("we.id IN (:...ids)", { ids })
        .andWhere("w.user_id = :userId", { userId })
        .getMany();
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of weChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.workoutExercises.push(this.toWorkoutExerciseItem(entity));
        } else {
          batch.workoutExercises.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    // Sets — need to join through workout_exercises → workouts for ownership.
    const setChanges = byType.get("set") || [];
    if (setChanges.length > 0) {
      const ids = setChanges.map((c) => c.entityId);
      const entities = await manager
        .createQueryBuilder(Set, "s")
        .innerJoin("s.workoutExercise", "we")
        .innerJoin("we.workout", "w")
        .where("s.id IN (:...ids)", { ids })
        .andWhere("w.user_id = :userId", { userId })
        .getMany();
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of setChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.sets.push(this.toSetItem(entity));
        } else {
          batch.sets.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    // Templates
    const templateChanges = byType.get("template") || [];
    if (templateChanges.length > 0) {
      const ids = templateChanges.map((c) => c.entityId);
      const entities = await manager.find(UserTemplate, { where: { id: In(ids), userId } });
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of templateChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.templates.push(this.toTemplateItem(entity));
        } else {
          batch.templates.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    // Template Exercises
    const teChanges = byType.get("templateExercise") || [];
    if (teChanges.length > 0) {
      const ids = teChanges.map((c) => c.entityId);
      const entities = await manager.find(UserTemplateExercise, { where: { id: In(ids), userId } });
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of teChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.templateExercises.push(this.toTemplateExerciseItem(entity));
        } else {
          batch.templateExercises.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    // Template Sets
    const tsChanges = byType.get("templateSet") || [];
    if (tsChanges.length > 0) {
      const ids = tsChanges.map((c) => c.entityId);
      const entities = await manager.find(UserTemplateSet, { where: { id: In(ids), userId } });
      const map = new Map(entities.map((e) => [e.id, e]));
      for (const ch of tsChanges) {
        const entity = map.get(ch.entityId);
        if (entity) {
          batch.templateSets.push(this.toTemplateSetItem(entity));
        } else {
          batch.templateSets.push({
            op: "delete",
            id: ch.entityId,
            revision: ch.revision,
            clientUpdatedAt: ch.createdAt.toISOString(),
            payload: null
          });
        }
      }
    }

    return { serverChanges: batch, nextRevision };
  }

  /**
   * Initial sync: load every syncable entity owned by the user.
   * Returns all entities plus the current max cursor so the client
   * has a starting point for future incremental pulls.
   */
  private async loadAllEntities(manager: EntityManager, userId: string): Promise<{ serverChanges: ReturnType<typeof emptyBatch>; nextRevision: number }> {
    const batch = emptyBatch();

    const workouts = await manager.find(Workout, { where: { userId } });
    batch.workouts = workouts.map((w) => this.toWorkoutItem(w));

    const workoutIds = workouts.map((w) => w.id);
    if (workoutIds.length > 0) {
      const exercises = await manager.createQueryBuilder(WorkoutExercise, "we").where("we.workout_id IN (:...ids)", { ids: workoutIds }).getMany();
      batch.workoutExercises = exercises.map((e) => this.toWorkoutExerciseItem(e));

      const exerciseIds = exercises.map((e) => e.id);
      if (exerciseIds.length > 0) {
        const sets = await manager.createQueryBuilder(Set, "s").where("s.workout_exercise_id IN (:...ids)", { ids: exerciseIds }).getMany();
        batch.sets = sets.map((s) => this.toSetItem(s));
      }
    }

    batch.templates = (await manager.find(UserTemplate, { where: { userId } })).map((t) => this.toTemplateItem(t));

    const templateIds = batch.templates.map((t) => t.id).filter(Boolean);
    if (templateIds.length > 0) {
      batch.templateExercises = (await manager.find(UserTemplateExercise, { where: { templateId: In(templateIds) } })).map((e) => this.toTemplateExerciseItem(e));

      const teIds = batch.templateExercises.map((e) => e.id).filter(Boolean);
      if (teIds.length > 0) {
        batch.templateSets = (await manager.find(UserTemplateSet, { where: { templateExerciseId: In(teIds) } })).map((s) => this.toTemplateSetItem(s));
      }
    }

    // Max cursor for this user: the highest sync_changes.id we've written.
    const maxRow = await manager.createQueryBuilder(SyncChange, "sc").select("MAX(sc.id)", "maxId").where("sc.user_id = :userId", { userId }).getRawOne<{ maxId: string | null }>();
    const nextRevision = maxRow?.maxId ? parseInt(maxRow.maxId, 10) : 0;

    return { serverChanges: batch, nextRevision };
  }

  // ─── Helpers: entity → response item ─────────────────────────────────────

  private toWorkoutItem(e: Workout): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            name: e.name,
            notes: e.notes,
            startedAt: e.startedAt.toISOString(),
            endedAt: e.endedAt ? e.endedAt.toISOString() : null,
            durationSeconds: e.durationSeconds,
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }

  private toWorkoutExerciseItem(e: WorkoutExercise): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            workoutId: e.workoutId,
            exerciseId: e.exerciseId,
            name: e.name,
            orderIndex: e.orderIndex,
            notes: e.notes,
            restSeconds: e.restSeconds,
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }

  private toSetItem(e: Set): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            workoutExerciseId: e.workoutExerciseId,
            orderIndex: e.orderIndex,
            weight: e.weight,
            reps: e.reps,
            rpe: e.rpe,
            isWarmup: e.isWarmup,
            isDropset: e.isDropset,
            isFailure: e.isFailure,
            durationSeconds: e.durationSeconds,
            distance: e.distance,
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }

  private toTemplateItem(e: UserTemplate): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            name: e.name,
            createdAt: e.createdAt.toISOString(),
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }

  private toTemplateExerciseItem(e: UserTemplateExercise): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            templateId: e.templateId,
            name: e.name,
            orderIndex: e.orderIndex,
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }

  private toTemplateSetItem(e: UserTemplateSet): SyncChangeItemDto {
    const deleted = e.isDeleted || !!e.deletedAt;
    return {
      op: deleted ? "delete" : "upsert",
      id: e.id,
      revision: e.revision ?? 1,
      clientUpdatedAt: (e.clientUpdatedAt ?? e.updatedAt).toISOString(),
      payload: deleted
        ? null
        : {
            id: e.id,
            templateExerciseId: e.templateExerciseId,
            orderIndex: e.orderIndex,
            weight: e.weight,
            reps: e.reps,
            isWarmup: e.isWarmup,
            isDropset: e.isDropset,
            isFailure: e.isFailure,
            revision: e.revision,
            serverUpdatedAt: e.updatedAt.toISOString(),
            clientUpdatedAt: e.clientUpdatedAt?.toISOString() ?? null,
            deletedAt: null
          }
    };
  }
}
