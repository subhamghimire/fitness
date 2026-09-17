import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, DataSource, EntityManager, In, MoreThan } from "typeorm";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";
import { Set } from "../workout/entities/set.entity";
import { WorkoutTemplate } from "../workout/entities/workout-template.entity";
import { WorkoutTemplateExercise } from "../workout/entities/workout-template-exercise.entity";
import { WorkoutTemplateSet } from "../workout/entities/workout-template-set.entity";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { SyncChange } from "./entities/sync-change.entity";
import { User } from "../users/entities/user.entity";
import { SyncWorkoutDto } from "./dto/sync-workout.dto";
import { SyncBatchRequestDto, SyncChangeItemDto } from "./dto/sync-batch.dto";
import { WorkoutService } from "../workout/workout.service";
import { WorkoutTemplateService } from "../workout/workout-template.service";
import { ProgressQueueService } from "../progress/progress-queue.service";

export const MAX_BATCH_ITEMS = 500;

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
    @InjectRepository(UserSyncState) private _syncStateRepo: Repository<UserSyncState>,
    @InjectRepository(SyncChange) private syncChangesRepo: Repository<SyncChange>,
    private dataSource: DataSource,
    private workoutService: WorkoutService,
    private workoutTemplateService: WorkoutTemplateService,
    private progressQueueService: ProgressQueueService
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
    const changes = dto.changes || {};
    const totalItems =
      (changes.workouts?.length ?? 0) +
      (changes.workoutExercises?.length ?? 0) +
      (changes.sets?.length ?? 0) +
      (changes.templates?.length ?? 0) +
      (changes.templateExercises?.length ?? 0) +
      (changes.templateSets?.length ?? 0);
    if (totalItems > MAX_BATCH_ITEMS) {
      throw new BadRequestException(`Sync batch exceeds maximum of ${MAX_BATCH_ITEMS} items (received ${totalItems})`);
    }

    const accepted: Accepted[] = [];
    const rejected: Rejected[] = [];
    const conflicts: Conflict[] = [];

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const manager = qr.manager;

      for (const item of changes.workouts || []) {
        await this.workoutService.applyWorkoutChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.workoutExercises || []) {
        await this.workoutService.applyWorkoutExerciseChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.sets || []) {
        await this.workoutService.applySetChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templates || []) {
        await this.workoutTemplateService.applyTemplateChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templateExercises || []) {
        await this.workoutTemplateService.applyTemplateExerciseChange(manager, user, item, accepted, rejected, conflicts);
      }
      for (const item of changes.templateSets || []) {
        await this.workoutTemplateService.applyTemplateSetChange(manager, user, item, accepted, rejected, conflicts);
      }

      // Schedule materialized-statistics reprojection for every touched workout
      // INSIDE the sync transaction: a committed workout mutation always has its
      // projection work enqueued atomically (no crash window). Retried batches
      // coalesce on the unique (user_id, workout_id) key and the projection is
      // an idempotent replace-on-write, so sync retries can never double-count.
      await this.progressQueueService.enqueueWorkoutsInTransaction(manager, user.id, {
        workouts: changes.workouts || [],
        workoutExercises: changes.workoutExercises || [],
        sets: changes.sets || []
      });

      const lastSyncRevision = dto.lastSyncRevision ?? 0;
      const { serverChanges, nextRevision } = await this.collectServerChanges(manager, user.id, lastSyncRevision);

      await manager.upsert(
        UserSyncState,
        {
          userId: user.id,
          syncRevision: nextRevision,
          clientId: dto.clientId
        },
        ["userId"]
      );

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

  // ─── Pull: cursor-based server changes ───────────────────────────────────

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

    // Sets
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
      const entities = await manager.find(WorkoutTemplate, { where: { id: In(ids), userId } });
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
      const entities = await manager.find(WorkoutTemplateExercise, { where: { id: In(ids), userId } });
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
      const entities = await manager.find(WorkoutTemplateSet, { where: { id: In(ids), userId } });
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

    batch.templates = (await manager.find(WorkoutTemplate, { where: { userId } })).map((t) => this.toTemplateItem(t));

    const templateIds = batch.templates.map((t) => t.id).filter(Boolean);
    if (templateIds.length > 0) {
      batch.templateExercises = (await manager.find(WorkoutTemplateExercise, { where: { templateId: In(templateIds) } })).map((e) => this.toTemplateExerciseItem(e));

      const teIds = batch.templateExercises.map((e) => e.id).filter(Boolean);
      if (teIds.length > 0) {
        batch.templateSets = (await manager.find(WorkoutTemplateSet, { where: { templateExerciseId: In(teIds) } })).map((s) => this.toTemplateSetItem(s));
      }
    }

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

  private toTemplateItem(e: WorkoutTemplate): SyncChangeItemDto {
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

  private toTemplateExerciseItem(e: WorkoutTemplateExercise): SyncChangeItemDto {
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

  private toTemplateSetItem(e: WorkoutTemplateSet): SyncChangeItemDto {
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
}
