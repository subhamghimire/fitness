import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, Repository } from "typeorm";
import { randomUUID } from "crypto";
import { WorkoutTemplate } from "./entities/workout-template.entity";
import { WorkoutTemplateExercise } from "./entities/workout-template-exercise.entity";
import { WorkoutTemplateSet } from "./entities/workout-template-set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { User } from "../users/entities/user.entity";
import { SyncChange } from "../sync/entities/sync-change.entity";
import { resolveWinner, isIdempotentReplay } from "./workout-conflict.util";
import { createPaginatedResponse } from "src/common/dto";
import { CreateWorkoutTemplateDto, CreateWorkoutTemplateExerciseDto, CreateWorkoutTemplateSetDto, WorkoutTemplateQueryDto } from "./dto";
import { WorkoutTemplateListItemDto, WorkoutTemplateResponseDto, WorkoutTemplateSetResponseDto } from "./dto";
import { WorkoutSyncChangeItem, SyncApplyAccepted, SyncApplyRejected, SyncApplyConflict, SyncOperation } from "./types/sync-apply.types";

/**
 * WORKOUT TEMPLATE domain service.
 *
 * Owns the business rules for planned workout structures (templates, their
 * exercises and planned sets): offline-first change application for sync plus
 * read/list/detail and online create/update/delete that also append sync
 * changelog entries so other devices converge.
 */
@Injectable()
export class WorkoutTemplateService {
  constructor(
    @InjectRepository(WorkoutTemplate) private readonly templatesRepo: Repository<WorkoutTemplate>,
    @InjectRepository(WorkoutTemplateExercise) private readonly templateExercisesRepo: Repository<WorkoutTemplateExercise>,
    @InjectRepository(WorkoutTemplateSet) private readonly templateSetsRepo: Repository<WorkoutTemplateSet>,
    @InjectRepository(Exercise) private readonly exercisesRepo: Repository<Exercise>,
    @InjectRepository(SyncChange) private readonly syncChangeRepo: Repository<SyncChange>
  ) {}

  // ─── Offline-first change application (called inside the sync transaction) ─

  async applyTemplateChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const existing = await manager.findOne(WorkoutTemplate, { where: { id: item.id } });
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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      await manager.save(WorkoutTemplate, existing);
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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      await manager.save(WorkoutTemplate, existing);
      await this.recordChange(manager, user.id, "template", item.id, "update", existing.revision);
    } else {
      await manager.insert(WorkoutTemplate, {
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

  async applyTemplateExerciseChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const p = item.payload || {};
    const existing = await manager.findOne(WorkoutTemplateExercise, { where: { id: item.id } });

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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      await manager.save(WorkoutTemplateExercise, existing);
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
        const target = await manager.findOne(WorkoutTemplate, { where: { id: templateId } });
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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      existing.exerciseId = (p.exerciseId as string) ?? existing.exerciseId;
      existing.name = (p.name as string) || existing.name;
      existing.orderIndex = (p.orderIndex as number) ?? existing.orderIndex;
      existing.notes = (p.notes as string) ?? existing.notes;
      existing.restSeconds = (p.restSeconds as number) ?? existing.restSeconds;
      existing.revision = Math.max(item.revision, serverRevision);
      existing.isDeleted = false;
      existing.deletedAt = null;
      existing.deletedBy = null;
      existing.clientUpdatedAt = new Date(item.clientUpdatedAt);
      await manager.save(WorkoutTemplateExercise, existing);
      await this.recordChange(manager, user.id, "templateExercise", item.id, "update", existing.revision);
    } else {
      const parent = await manager.findOne(WorkoutTemplate, { where: { id: templateId } });
      if (!parent || parent.userId !== user.id) {
        rejected.push({ entityType: "templateExercise", id: item.id, reason: "ownership" });
        return;
      }
      await manager.insert(WorkoutTemplateExercise, {
        id: item.id,
        templateId,
        userId: user.id,
        exerciseId: (p.exerciseId as string) ?? null,
        name: (p.name as string) || "Exercise",
        orderIndex: (p.orderIndex as number) ?? 0,
        notes: (p.notes as string) ?? null,
        restSeconds: (p.restSeconds as number) ?? null,
        revision: item.revision,
        clientUpdatedAt: new Date(item.clientUpdatedAt)
      });
      await this.recordChange(manager, user.id, "templateExercise", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "templateExercise", id: item.id, revision: item.revision });
  }

  async applyTemplateSetChange(
    manager: EntityManager,
    user: User,
    item: WorkoutSyncChangeItem,
    accepted: SyncApplyAccepted[],
    rejected: SyncApplyRejected[],
    conflicts: SyncApplyConflict[]
  ): Promise<void> {
    const p = item.payload || {};
    const existing = await manager.findOne(WorkoutTemplateSet, { where: { id: item.id } });

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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      await manager.save(WorkoutTemplateSet, existing);
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
        if (!isIdempotentReplay(serverRevision, item.revision, existing.clientUpdatedAt, item.clientUpdatedAt)) {
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
      await manager.save(WorkoutTemplateSet, existing);
      await this.recordChange(manager, user.id, "templateSet", item.id, "update", existing.revision);
    } else {
      if (!(await this.templateExerciseOwnedBy(manager, templateExerciseId, user.id))) {
        rejected.push({ entityType: "templateSet", id: item.id, reason: "ownership" });
        return;
      }
      await manager.insert(WorkoutTemplateSet, {
        id: item.id,
        templateExerciseId,
        userId: user.id,
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
      await this.recordChange(manager, user.id, "templateSet", item.id, "create", item.revision);
    }
    accepted.push({ entityType: "templateSet", id: item.id, revision: item.revision });
  }

  // ─── Read APIs ────────────────────────────────────────────────────────────

  async list(userId: string, query: WorkoutTemplateQueryDto) {
    const { search, page = 1, limit = 20 } = query;
    const qb = this.templatesRepo.createQueryBuilder("t").where("t.userId = :userId", { userId }).andWhere("t.isDeleted = :deleted", { deleted: false });
    if (search) qb.andWhere("t.name ILIKE :search", { search: `%${search}%` });
    qb.orderBy("t.updatedAt", "DESC");

    const total = await qb.getCount();
    qb.skip((page - 1) * limit).take(limit);
    const templates = await qb.getMany();
    const items = await this.toListItems(templates);
    return createPaginatedResponse(items, total, page, limit);
  }

  async getDetail(userId: string, id: string): Promise<WorkoutTemplateResponseDto> {
    const template = await this.templatesRepo.findOne({ where: { id, userId, isDeleted: false } });
    if (!template) {
      throw new NotFoundException("Workout template not found");
    }
    return this.toDetail(template);
  }

  // ─── Online write APIs (also propagate to the sync changelog) ────────────

  async create(userId: string, dto: CreateWorkoutTemplateDto): Promise<WorkoutTemplateResponseDto> {
    const now = new Date();
    const template = this.templatesRepo.create({
      id: randomUUID(),
      userId,
      name: dto.name,
      revision: 1,
      clientUpdatedAt: now
    });
    await this.templatesRepo.save(template);
    await this.syncChangeRepo.insert({ userId, entityType: "template", entityId: template.id, operation: "create", revision: 1 });

    for (const ex of dto.exercises ?? []) {
      await this.insertExercise(userId, template.id, ex, now);
    }
    return this.toDetail(template);
  }

  async update(userId: string, id: string, dto: Partial<CreateWorkoutTemplateDto>): Promise<WorkoutTemplateResponseDto> {
    const template = await this.templatesRepo.findOne({ where: { id, userId, isDeleted: false } });
    if (!template) throw new NotFoundException("Workout template not found");

    const nextRevision = (template.revision ?? 1) + 1;
    const now = new Date();
    if (dto.name) template.name = dto.name;
    template.revision = nextRevision;
    template.clientUpdatedAt = now;
    await this.templatesRepo.save(template);
    await this.syncChangeRepo.insert({ userId, entityType: "template", entityId: template.id, operation: "update", revision: nextRevision });

    if (dto.exercises) await this.replaceExercises(userId, template.id, dto.exercises, nextRevision, now);

    return this.toDetail(template);
  }

  async remove(userId: string, id: string): Promise<{ success: boolean; message: string }> {
    const template = await this.templatesRepo.findOne({ where: { id, userId } });
    if (!template) throw new NotFoundException("Workout template not found");

    const nextRevision = (template.revision ?? 1) + 1;
    const now = new Date();
    const exercises = await this.templateExercisesRepo.find({ where: { templateId: template.id, isDeleted: false } });
    const exerciseIds = exercises.map((e) => e.id);
    const sets = exerciseIds.length ? await this.templateSetsRepo.find({ where: { templateExerciseId: In(exerciseIds), isDeleted: false } }) : [];

    for (const s of sets) {
      s.isDeleted = true;
      s.deletedAt = now;
      s.deletedBy = userId;
      s.revision = nextRevision;
      s.clientUpdatedAt = now;
      await this.templateSetsRepo.save(s);
      await this.syncChangeRepo.insert({ userId, entityType: "templateSet", entityId: s.id, operation: "delete", revision: nextRevision });
    }
    for (const e of exercises) {
      e.isDeleted = true;
      e.deletedAt = now;
      e.deletedBy = userId;
      e.revision = nextRevision;
      e.clientUpdatedAt = now;
      await this.templateExercisesRepo.save(e);
      await this.syncChangeRepo.insert({ userId, entityType: "templateExercise", entityId: e.id, operation: "delete", revision: nextRevision });
    }

    template.isDeleted = true;
    template.deletedAt = now;
    template.deletedBy = userId;
    template.revision = nextRevision;
    template.clientUpdatedAt = now;
    await this.templatesRepo.save(template);
    await this.syncChangeRepo.insert({ userId, entityType: "template", entityId: template.id, operation: "delete", revision: nextRevision });

    return { success: true, message: "Workout template removed" };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async insertExercise(userId: string, templateId: string, dto: CreateWorkoutTemplateExerciseDto, now: Date): Promise<void> {
    const exercise = this.templateExercisesRepo.create({
      id: randomUUID(),
      templateId,
      userId,
      exerciseId: dto.exerciseId ?? null,
      name: dto.name,
      orderIndex: dto.orderIndex ?? 0,
      notes: dto.notes ?? null,
      restSeconds: dto.restSeconds ?? null,
      revision: 1,
      clientUpdatedAt: now
    });
    await this.templateExercisesRepo.save(exercise);
    await this.syncChangeRepo.insert({
      userId,
      entityType: "templateExercise",
      entityId: exercise.id,
      operation: "create",
      revision: 1
    });
    for (const s of dto.sets ?? []) {
      await this.insertSet(userId, exercise.id, s, now);
    }
  }

  private async insertSet(userId: string, templateExerciseId: string, dto: CreateWorkoutTemplateSetDto, now: Date): Promise<void> {
    const set = this.templateSetsRepo.create({
      id: randomUUID(),
      templateExerciseId,
      userId,
      orderIndex: dto.orderIndex ?? 0,
      weight: dto.weight ?? null,
      reps: dto.reps ?? null,
      rpe: dto.rpe ?? null,
      isWarmup: dto.isWarmup ?? false,
      isDropset: dto.isDropset ?? false,
      isFailure: dto.isFailure ?? false,
      durationSeconds: dto.durationSeconds ?? null,
      distance: dto.distance ?? null,
      revision: 1,
      clientUpdatedAt: now
    });
    await this.templateSetsRepo.save(set);
    await this.syncChangeRepo.insert({
      userId,
      entityType: "templateSet",
      entityId: set.id,
      operation: "create",
      revision: 1
    });
  }

  private async replaceExercises(userId: string, templateId: string, next: CreateWorkoutTemplateExerciseDto[], revision: number, now: Date): Promise<void> {
    const existing = await this.templateExercisesRepo.find({ where: { templateId, isDeleted: false } });
    const existingIds = existing.map((e) => e.id);
    const existingSets = existingIds.length ? await this.templateSetsRepo.find({ where: { templateExerciseId: In(existingIds), isDeleted: false } }) : [];

    for (const s of existingSets) {
      s.isDeleted = true;
      s.deletedAt = now;
      s.deletedBy = userId;
      s.revision = revision;
      s.clientUpdatedAt = now;
      await this.templateSetsRepo.save(s);
      await this.syncChangeRepo.insert({ userId, entityType: "templateSet", entityId: s.id, operation: "delete", revision });
    }
    for (const e of existing) {
      e.isDeleted = true;
      e.deletedAt = now;
      e.deletedBy = userId;
      e.revision = revision;
      e.clientUpdatedAt = now;
      await this.templateExercisesRepo.save(e);
      await this.syncChangeRepo.insert({ userId, entityType: "templateExercise", entityId: e.id, operation: "delete", revision });
    }
    for (const ex of next) {
      await this.insertExercise(userId, templateId, ex, now);
    }
  }

  private async toListItems(templates: WorkoutTemplate[]): Promise<WorkoutTemplateListItemDto[]> {
    if (templates.length === 0) return [];
    const ids = templates.map((t) => t.id);
    const exercises = ids.length ? await this.templateExercisesRepo.find({ where: { templateId: In(ids), isDeleted: false } }) : [];
    const countByTemplate = new Map<string, number>();
    for (const e of exercises) {
      countByTemplate.set(e.templateId, (countByTemplate.get(e.templateId) ?? 0) + 1);
    }
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      exerciseCount: countByTemplate.get(t.id) ?? 0,
      revision: t.revision,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }));
  }

  private async toDetail(template: WorkoutTemplate): Promise<WorkoutTemplateResponseDto> {
    const exercises = await this.templateExercisesRepo.find({
      where: { templateId: template.id, isDeleted: false },
      order: { orderIndex: "ASC" }
    });
    const exerciseIds = exercises.map((e) => e.id);
    const sets = exerciseIds.length ? await this.templateSetsRepo.find({ where: { templateExerciseId: In(exerciseIds), isDeleted: false } }) : [];
    const setsByExercise = new Map<string, WorkoutTemplateSet[]>();
    for (const s of sets) {
      const list = setsByExercise.get(s.templateExerciseId) || [];
      list.push(s);
      setsByExercise.set(s.templateExerciseId, list);
    }

    const catalogIds: string[] = [];
    for (const id of [...exercises.map((e) => e.exerciseId).filter((x): x is string => Boolean(x))]) {
      if (!catalogIds.includes(id)) catalogIds.push(id);
    }
    const catalog = catalogIds.length ? await this.exercisesRepo.find({ where: { id: In(catalogIds) } }) : [];
    const catalogById = new Map(catalog.map((c) => [c.id, c]));

    return {
      id: template.id,
      name: template.name,
      revision: template.revision,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      exercises: exercises.map((e) => ({
        id: e.id,
        exerciseId: e.exerciseId,
        name: e.name,
        orderIndex: e.orderIndex,
        notes: e.notes,
        restSeconds: e.restSeconds,
        exercise: e.exerciseId ? this.toExerciseMeta(catalogById.get(e.exerciseId)) : undefined,
        sets: this.toSetDtos(setsByExercise.get(e.id) || [])
      }))
    };
  }

  private toExerciseMeta(exercise: Exercise | undefined): { id: string; title: string; slug: string } | undefined {
    if (!exercise) return undefined;
    return { id: exercise.id, title: exercise.title, slug: exercise.slug };
  }

  private toSetDtos(sets: WorkoutTemplateSet[]): WorkoutTemplateSetResponseDto[] {
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

  // ─── Ownership helpers ────────────────────────────────────────────────────

  private async userOwnsTemplateExercise(manager: EntityManager, userId: string, te: WorkoutTemplateExercise): Promise<boolean> {
    if (!te.templateId) return false;
    const template = await manager.findOne(WorkoutTemplate, { where: { id: te.templateId } });
    return !!template && template.userId === userId;
  }

  private async templateExerciseOwnedBy(manager: EntityManager, templateExerciseId: string, userId: string): Promise<boolean> {
    const te = await manager.findOne(WorkoutTemplateExercise, { where: { id: templateExerciseId } });
    if (!te) return false;
    return this.userOwnsTemplateExercise(manager, userId, te);
  }

  private async userOwnsTemplateSet(manager: EntityManager, userId: string, ts: WorkoutTemplateSet): Promise<boolean> {
    if (!ts.templateExerciseId) return false;
    return this.templateExerciseOwnedBy(manager, ts.templateExerciseId, userId);
  }

  private async recordChange(manager: EntityManager, userId: string, entityType: string, entityId: string, operation: SyncOperation, revision: number): Promise<void> {
    await manager.insert(SyncChange, { userId, entityType, entityId, operation, revision });
  }
}
