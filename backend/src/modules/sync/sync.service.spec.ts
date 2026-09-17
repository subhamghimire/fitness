import { DataSource, FindOperator, ObjectLiteral, Repository } from "typeorm";
import { SyncService } from "./sync.service";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";
import { Set } from "../workout/entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { WorkoutTemplate } from "../workout/entities/workout-template.entity";
import { WorkoutTemplateExercise } from "../workout/entities/workout-template-exercise.entity";
import { WorkoutTemplateSet } from "../workout/entities/workout-template-set.entity";
import { WorkoutService } from "../workout/workout.service";
import { WorkoutTemplateService } from "../workout/workout-template.service";
import { ExerciseService } from "../exercise/exercise.service";
import { ConfigService } from "@nestjs/config";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { SyncChange } from "./entities/sync-change.entity";
import { SyncBatchRequestDto, SyncBatchChangesDto, SyncChangeItemDto } from "./dto/sync-batch.dto";
import { User } from "../users/entities/user.entity";
import { ProgressQueueService } from "../progress/progress-queue.service";

type TableKey =
  | "workouts"
  | "workout_exercises"
  | "sets"
  | "workout_templates"
  | "workout_template_exercises"
  | "workout_template_sets"
  | "user_sync_state"
  | "sync_changes"
  | "exercises";

type AnyEntity = Workout | WorkoutExercise | Set | WorkoutTemplate | WorkoutTemplateExercise | WorkoutTemplateSet | UserSyncState | SyncChange | Exercise;

/** A stored row, read/written through an index-signature view of the entity. */
type Row = Record<string, unknown>;

const OWN_ALIAS: Record<TableKey, string> = {
  workouts: "w",
  workout_exercises: "we",
  sets: "s",
  workout_templates: "t",
  workout_template_exercises: "te",
  workout_template_sets: "ts",
  sync_changes: "sc",
  exercises: "ex",
  user_sync_state: "us"
};

const COL_TO_PROP: Record<string, string> = {
  id: "id",
  user_id: "userId",
  workout_id: "workoutId",
  exercise_id: "exerciseId",
  workout_exercise_id: "workoutExerciseId",
  template_id: "templateId",
  template_exercise_id: "templateExerciseId",
  order_index: "orderIndex",
  client_updated_at: "clientUpdatedAt"
};

interface TableStore {
  workouts: Map<string, Workout>;
  workout_exercises: Map<string, WorkoutExercise>;
  sets: Map<string, Set>;
  workout_templates: Map<string, WorkoutTemplate>;
  workout_template_exercises: Map<string, WorkoutTemplateExercise>;
  workout_template_sets: Map<string, WorkoutTemplateSet>;
  user_sync_state: Map<string, UserSyncState>;
  sync_changes: Map<string, SyncChange>;
  exercises: Map<string, Exercise>;
}

interface MemoryDb {
  tables: TableStore;
  nextChangeId: number;
}

function createMemoryDb(): MemoryDb {
  return {
    tables: {
      workouts: new Map(),
      workout_exercises: new Map(),
      sets: new Map(),
      workout_templates: new Map(),
      workout_template_exercises: new Map(),
      workout_template_sets: new Map(),
      user_sync_state: new Map(),
      sync_changes: new Map(),
      exercises: new Map()
    },
    nextChangeId: 1
  };
}

/** Read/write access to any table's rows, as a union of entity types. */
function tableStore(tables: TableStore, key: TableKey): Map<string, AnyEntity> {
  switch (key) {
    case "workouts":
      return tables.workouts as unknown as Map<string, AnyEntity>;
    case "workout_exercises":
      return tables.workout_exercises as unknown as Map<string, AnyEntity>;
    case "sets":
      return tables.sets as unknown as Map<string, AnyEntity>;
    case "workout_templates":
      return tables.workout_templates as unknown as Map<string, AnyEntity>;
    case "workout_template_exercises":
      return tables.workout_template_exercises as unknown as Map<string, AnyEntity>;
    case "workout_template_sets":
      return tables.workout_template_sets as unknown as Map<string, AnyEntity>;
    case "user_sync_state":
      return tables.user_sync_state as unknown as Map<string, AnyEntity>;
    case "sync_changes":
      return tables.sync_changes as unknown as Map<string, AnyEntity>;
    case "exercises":
      return tables.exercises as unknown as Map<string, AnyEntity>;
  }
}

function asRow(entity: AnyEntity): Row {
  return entity as unknown as Row;
}

function tableFor(EC: unknown): TableKey {
  if (EC === Workout) return "workouts";
  if (EC === WorkoutExercise) return "workout_exercises";
  if (EC === Set) return "sets";
  if (EC === WorkoutTemplate) return "workout_templates";
  if (EC === WorkoutTemplateExercise) return "workout_template_exercises";
  if (EC === WorkoutTemplateSet) return "workout_template_sets";
  if (EC === UserSyncState) return "user_sync_state";
  if (EC === SyncChange) return "sync_changes";
  if (EC === Exercise) return "exercises";
  throw new Error("unknown entity table");
}

function operator(v: unknown): { type: string; value: unknown } | null {
  if (v instanceof FindOperator) {
    return { type: v.type, value: v.value };
  }
  return null;
}

function matchesWhere(row: AnyEntity, where: Row | undefined): boolean {
  if (!where) return true;
  const rec = asRow(row);
  return Object.entries(where).every(([k, v]) => {
    const op = operator(v);
    if (op) {
      if (op.type === "in") return (op.value as unknown[]).includes(rec[k]);
      if (op.type === "moreThan") return Number(rec[k]) > Number(op.value);
      if (op.type === "equals") return rec[k] === op.value;
      return true;
    }
    return rec[k] === v || (rec[k] == null && v == null);
  });
}

/** Resolve a row referenced by a qb alias (parents are followed through FKs). */
function resolveRow(alias: string, sourceTable: TableKey, row: AnyEntity, tables: TableStore): AnyEntity | undefined {
  if (alias === OWN_ALIAS[sourceTable]) return row;
  const rec = asRow(row);
  const get = (t: TableKey, id: unknown): AnyEntity | undefined => (id == null || typeof id !== "string" ? undefined : tableStore(tables, t).get(String(id)));

  if (sourceTable === "workout_exercises" && alias === "w") return get("workouts", rec["workoutId"]);
  if (sourceTable === "sets" && alias === "we") return get("workout_exercises", rec["workoutExerciseId"]);
  if (sourceTable === "sets" && alias === "w") {
    const we = get("workout_exercises", rec["workoutExerciseId"]);
    return we ? get("workouts", asRow(we)["workoutId"]) : undefined;
  }
  return undefined;
}

type WhereClause = {
  alias: string;
  col: string;
  prop: string;
  op: "in" | "eq" | "moreThan";
  values: unknown[];
  value: unknown;
};

class MockQueryBuilder {
  private maxSelect: { prop: string; aliasOut: string } | null = null;
  private clauses: WhereClause[] = [];

  constructor(
    private db: MemoryDb,
    private table: TableKey,
    private alias: string
  ) {}

  select(selection: string, aliasOut: string): this {
    const m = selection.match(/MAX\(([a-z_]+)\.([a-z_]+)\)/i);
    if (m) this.maxSelect = { prop: COL_TO_PROP[m[2]] ?? m[2], aliasOut };
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(cond: string, params: Record<string, unknown>): this {
    return this.parse(cond, params);
  }

  andWhere(cond: string, params: Record<string, unknown>): this {
    return this.parse(cond, params);
  }

  private parse(cond: string, params: Record<string, unknown>): this {
    const inMatch = cond.match(/^([a-z_]+)\.([a-z_]+) IN \(:\.\.\.([a-zA-Z]+)\)$/);
    if (inMatch) {
      const [, alias, col, paramName] = inMatch;
      this.clauses.push({
        alias,
        col,
        prop: COL_TO_PROP[col] ?? col,
        op: "in",
        values: (params[paramName] as unknown[]) ?? [],
        value: undefined
      });
      return this;
    }
    const eqMatch = cond.match(/^([a-z_]+)\.([a-z_]+) = :([a-zA-Z]+)$/);
    if (eqMatch) {
      const [, alias, col, paramName] = eqMatch;
      this.clauses.push({
        alias,
        col,
        prop: COL_TO_PROP[col] ?? col,
        op: "eq",
        values: [],
        value: params[paramName]
      });
    }
    return this;
  }

  private applyFilters(): AnyEntity[] {
    const rows = [...tableStore(this.db.tables, this.table).values()];
    return rows.filter((row) =>
      this.clauses.every((w) => {
        const target = resolveRow(w.alias, this.table, row, this.db.tables);
        if (target == null) return false;
        const rec = asRow(target);
        if (w.op === "in") return w.values.includes(rec[w.prop]);
        return rec[w.prop] === w.value;
      })
    );
  }

  getRawOne<T>(): T | null {
    const rows = this.applyFilters();
    if (this.maxSelect) {
      const maxSel = this.maxSelect;
      const max = rows.reduce((m: number, r) => Math.max(m, Number(asRow(r)[maxSel.prop] ?? 0)), 0);
      return { [maxSel.aliasOut]: max === 0 ? null : String(max) } as T;
    }
    return (rows[0] ?? null) as T | null;
  }

  getMany<T>(): T[] {
    return this.applyFilters() as T[];
  }
}

interface MockManager {
  findOne(EC: unknown, opts?: { where?: Row }): Promise<AnyEntity | null>;
  find(EC: unknown, opts?: { where?: Row; order?: Record<string, string> }): Promise<AnyEntity[]>;
  insert(EC: unknown, data: Row): Promise<void>;
  upsert(EC: unknown, data: Row | Row[], conflictPaths: string[]): Promise<void>;
  save(EC: unknown, entity: AnyEntity): Promise<AnyEntity>;
  create(EC: unknown, data: Row): AnyEntity;
  createQueryBuilder(EC: unknown, alias: string): MockQueryBuilder;
}

interface MockQueryRunner {
  manager: MockManager;
  connect: jest.Mock<Promise<void>, []>;
  startTransaction: jest.Mock<Promise<void>, []>;
  commitTransaction: jest.Mock<Promise<void>, []>;
  rollbackTransaction: jest.Mock<Promise<void>, []>;
  release: jest.Mock<Promise<void>, []>;
}

function makeManager(db: MemoryDb): MockManager {
  return {
    findOne(EC: unknown, opts?: { where?: Row }): Promise<AnyEntity | null> {
      const store = tableStore(db.tables, tableFor(EC));
      for (const row of store.values()) {
        if (matchesWhere(row, opts?.where)) return Promise.resolve(row);
      }
      return Promise.resolve(null);
    },

    find(EC: unknown, opts?: { where?: Row; order?: Record<string, string> }): Promise<AnyEntity[]> {
      const store = tableStore(db.tables, tableFor(EC));
      const rows = [...store.values()].filter((r) => matchesWhere(r, opts?.where));
      if (opts?.order) {
        for (const [key, dir] of Object.entries(opts.order)) {
          const asc = dir.toUpperCase() === "ASC";
          rows.sort((a, b) => {
            const va = Number(asRow(a)[key]);
            const vb = Number(asRow(b)[key]);
            return asc ? va - vb : vb - va;
          });
        }
      }
      return Promise.resolve(rows);
    },

    insert(EC: unknown, data: Row): Promise<void> {
      const store = tableStore(db.tables, tableFor(EC));
      if (EC === SyncChange) {
        const id = db.nextChangeId++;
        store.set(String(id), { ...data, id, createdAt: new Date() } as unknown as SyncChange);
        return Promise.resolve();
      }
      const row = {
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        clientUpdatedAt: null,
        ...data,
        id: data.id
      };
      store.set(String(row.id), row as unknown as AnyEntity);
      return Promise.resolve();
    },

    upsert(EC: unknown, data: Row | Row[], conflictPaths: string[]): Promise<void> {
      const store = tableStore(db.tables, tableFor(EC));
      const rows = Array.isArray(data) ? data : [data];
      const insertViaFactory = (entityClass: unknown, row: Row): Promise<void> => makeManager(db).insert(entityClass, row);
      for (const row of rows) {
        const existing = [...store.values()].find((r) => conflictPaths.every((p) => asRow(r)[p] === row[p]));
        if (existing) {
          Object.assign(existing, row);
        } else {
          void insertViaFactory(EC, row);
        }
      }
      return Promise.resolve();
    },

    save(EC: unknown, entity: AnyEntity): Promise<AnyEntity> {
      const store = tableStore(db.tables, tableFor(EC));
      const row = asRow(entity);
      if (row.id == null) {
        row.id = `gen-${Math.random().toString(36).slice(2)}`;
      }
      store.set(String(row.id), entity);
      return Promise.resolve(entity);
    },

    create(EC: unknown, data: Row): AnyEntity {
      return { ...data } as unknown as AnyEntity;
    },

    createQueryBuilder(EC: unknown, alias: string): MockQueryBuilder {
      return new MockQueryBuilder(db, tableFor(EC), alias);
    }
  };
}

function makeService(db: MemoryDb): { service: SyncService; manager: MockManager; qr: MockQueryRunner } {
  const manager = makeManager(db);
  const qr: MockQueryRunner = {
    manager,
    connect: jest.fn(() => Promise.resolve()),
    startTransaction: jest.fn(() => Promise.resolve()),
    commitTransaction: jest.fn(() => Promise.resolve()),
    rollbackTransaction: jest.fn(() => Promise.resolve()),
    release: jest.fn(() => Promise.resolve())
  };
  const dataSource = { createQueryRunner: () => qr } as unknown as DataSource;
  const service = new SyncService(noRepo<UserSyncState>(), noRepo<SyncChange>(), dataSource, makeWorkoutService(), makeWorkoutTemplateService(), noProgressQueue());
  return { service, manager, qr };
}

function noRepo<T extends ObjectLiteral>(): Repository<T> {
  return {} as unknown as Repository<T>;
}

function noProgressQueue(): ProgressQueueService {
  return { enqueueWorkoutsInTransaction: jest.fn().mockResolvedValue(undefined) } as unknown as ProgressQueueService;
}

function makeWorkoutService(): WorkoutService {
  const exerciseService = new ExerciseService(exerciseRepo(), {} as unknown as never, {} as unknown as ConfigService);
  return new WorkoutService(noRepo<Workout>(), noRepo<WorkoutExercise>(), noRepo<Set>(), noRepo<Exercise>(), exerciseService);
}

function exerciseRepo(): Repository<Exercise> {
  return { create: (data: Row) => ({ ...data }) } as unknown as Repository<Exercise>;
}

function makeWorkoutTemplateService(): WorkoutTemplateService {
  return new WorkoutTemplateService(noRepo<WorkoutTemplate>(), noRepo<WorkoutTemplateExercise>(), noRepo<WorkoutTemplateSet>(), noRepo<Exercise>(), noRepo<SyncChange>());
}

const userA = { id: "aaaa", email: "a@test.com" } as User;
const userB = { id: "bbbb", email: "b@test.com" } as User;

const item = (partial: Partial<SyncChangeItemDto> & { id: string }): SyncChangeItemDto => ({
  op: "upsert",
  revision: 1,
  clientUpdatedAt: "2026-01-01T00:00:00.000Z",
  payload: {},
  ...partial
});

const workoutPayload = (over: Record<string, unknown> = {}) => ({
  id: "w1",
  name: "Leg Day",
  notes: null,
  startedAt: "2026-01-01T08:00:00.000Z",
  endedAt: null,
  durationSeconds: null,
  ...over
});

function seedWorkout(db: MemoryDb, over: Partial<Workout> = {}): void {
  const row = {
    id: "w1",
    userId: userA.id,
    name: "Leg Day",
    notes: null,
    startedAt: new Date("2026-01-01T08:00:00.000Z"),
    endedAt: null,
    durationSeconds: null,
    revision: 1,
    clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z"),
    updatedAt: new Date("2026-01-01T08:00:00.000Z"),
    createdAt: new Date("2026-01-01T08:00:00.000Z"),
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    ...over
  } as Workout;
  db.tables.workouts.set(row.id, row);
}

const changes = (workouts: SyncChangeItemDto[] = []): SyncBatchChangesDto => ({ workouts });

function pushRequest(workouts: SyncChangeItemDto[], lastSyncRevision = 0, clientId = "client-1"): SyncBatchRequestDto {
  return { lastSyncRevision, clientId, changes: changes(workouts) };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SyncService sync scenarios", () => {
  describe("push", () => {
    it("create offline: accepts and records a create change", async () => {
      const db = createMemoryDb();
      const { service } = makeService(db);

      const res = await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 1,
            clientUpdatedAt: "2026-01-01T10:00:00.000Z",
            payload: workoutPayload()
          })
        ]),
        userA
      );

      expect(res.accepted).toEqual([{ entityType: "workout", id: "w1", revision: 1 }]);
      expect(res.rejected).toEqual([]);
      const stored = db.tables.workouts.get("w1")!;
      expect(stored.userId).toBe(userA.id);
      expect(stored.clientUpdatedAt!.toISOString()).toBe("2026-01-01T10:00:00.000Z");
      const log = [...db.tables.sync_changes.values()];
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        userId: userA.id,
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        revision: 1
      });
    });

    it("update offline: accepts and records an update change", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      const res = await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T10:00:00.000Z",
            payload: workoutPayload({ name: "Push Day" })
          })
        ]),
        userA
      );

      expect(res.accepted).toHaveLength(1);
      expect(res.rejected).toHaveLength(0);
      expect(db.tables.workouts.get("w1")!.name).toBe("Push Day");
      expect(db.tables.workouts.get("w1")!.revision).toBe(2);
      const ops = [...db.tables.sync_changes.values()].map((c) => c.operation);
      expect(ops).toEqual(["update"]);
    });

    it("delete offline: accepts and records a delete change (tombstone)", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      const res = await service.syncBatch(
        pushRequest([
          item({
            op: "delete",
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T10:00:00.000Z",
            payload: null
          })
        ]),
        userA
      );

      expect(res.accepted).toHaveLength(1);
      const stored = db.tables.workouts.get("w1")!;
      expect(stored.isDeleted).toBe(true);
      expect(stored.deletedBy).toBe(userA.id);
      const ops = [...db.tables.sync_changes.values()].map((c) => c.operation);
      expect(ops).toEqual(["delete"]);
    });

    it("duplicate push: same revision is idempotent, no conflict reported", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      const dto = pushRequest([
        item({
          id: "w1",
          revision: 2,
          clientUpdatedAt: "2026-01-02T10:00:00.000Z",
          payload: workoutPayload({ name: "Push Day" })
        })
      ]);
      const first = await service.syncBatch(dto, userA);
      const second = await service.syncBatch(dto, userA);

      expect(first.accepted).toHaveLength(1);
      expect(first.conflicts).toHaveLength(0);
      // Retry: accepted silently, no conflict, entity revision unchanged.
      expect(second.accepted).toHaveLength(1);
      expect(second.conflicts).toEqual([]);
      expect(db.tables.workouts.get("w1")!.revision).toBe(2);
    });

    it("delayed push: older clientUpdatedAt loses to already-accepted newer mutation", async () => {
      const db = createMemoryDb();
      // Server already accepted a mutation at T2 (clientUpdatedAt=T2, revision 2).
      seedWorkout(db, { revision: 2, clientUpdatedAt: new Date("2026-01-02T10:00:00.000Z") });
      const { service } = makeService(db);

      const res = await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 1,
            clientUpdatedAt: "2026-01-01T10:00:00.000Z",
            payload: workoutPayload({ name: "Stale" })
          })
        ]),
        userA
      );

      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0].resolvedWith).toBe("server");
      expect(res.accepted[0].revision).toBe(2); // server authoritative
      expect(db.tables.workouts.get("w1")!.name).toBe("Leg Day"); // unchanged
    });

    it("out-of-order push: newer clientUpdatedAt wins regardless of arrival order", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      // Device A pushes an OLD change (T1) but arrives SECOND chronologically.
      const stale = pushRequest([
        item({
          id: "w1",
          revision: 2,
          clientUpdatedAt: "2026-01-01T12:00:00.000Z",
          payload: workoutPayload({ name: "Oddles" })
        })
      ]);
      // Device B pushes a NEW change (T2) first.
      const fresh = pushRequest([
        item({
          id: "w1",
          revision: 3,
          clientUpdatedAt: "2026-01-03T12:00:00.000Z",
          payload: workoutPayload({ name: "Fresh" })
        })
      ]);
      await service.syncBatch(fresh, userA);
      const staleRes = await service.syncBatch(stale, userA);

      expect(staleRes.conflicts).toHaveLength(1);
      expect(db.tables.workouts.get("w1")!.name).toBe("Fresh");
      expect(db.tables.workouts.get("w1")!.clientUpdatedAt!.toISOString()).toBe("2026-01-03T12:00:00.000Z");
    });

    it("concurrent updates: last-writer-wins by clientUpdatedAt", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      // Two devices update the same entity concurrently, different timestamps.
      await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T00:00:00.000Z",
            payload: workoutPayload({ name: "DevA" })
          })
        ]),
        userA
      );
      await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 3,
            clientUpdatedAt: "2026-01-03T00:00:00.000Z",
            payload: workoutPayload({ name: "DevB" })
          })
        ]),
        userA
      );

      expect(db.tables.workouts.get("w1")!.name).toBe("DevB");
      expect(db.tables.workouts.get("w1")!.revision).toBe(3);
    });

    it("delete vs update: newer delete wins over older update", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      // Device B deletes at T4.
      await service.syncBatch(
        pushRequest([
          item({
            op: "delete",
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-04T00:00:00.000Z",
            payload: null
          })
        ]),
        userA
      );
      expect(db.tables.workouts.get("w1")!.isDeleted).toBe(true);

      // Device A tries an update with OLDER timestamp T3 → rejected, delete preserved.
      const res = await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 3,
            clientUpdatedAt: "2026-01-03T00:00:00.000Z",
            payload: workoutPayload({ name: "TooLate" })
          })
        ]),
        userA
      );
      expect(res.conflicts).toHaveLength(1);
      const stored = db.tables.workouts.get("w1")!;
      expect(stored.isDeleted).toBe(true);
      expect(stored.name).toBe("Leg Day");
    });

    it("unauthorized mutation: cannot modify another user's workout", async () => {
      const db = createMemoryDb();
      seedWorkout(db, { userId: userB.id });
      const { service } = makeService(db);

      const res = await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T00:00:00.000Z",
            payload: workoutPayload()
          })
        ]),
        userA
      );

      expect(res.rejected).toEqual([{ entityType: "workout", id: "w1", reason: "ownership" }]);
      expect(db.tables.workouts.get("w1")!.userId).toBe(userB.id);
    });

    it("rejected create: workoutExercise without parent workout is rejected", async () => {
      const db = createMemoryDb();
      const { service } = makeService(db);
      const res = await service.syncBatch(
        {
          lastSyncRevision: 0,
          clientId: "client-1",
          changes: {
            workoutExercises: [
              item({
                id: "we1",
                revision: 1,
                clientUpdatedAt: "2026-01-01T00:00:00.000Z",
                payload: { id: "we1", workoutId: "w-missing", name: "Squat", orderIndex: 0 }
              })
            ]
          }
        },
        userA
      );
      expect(res.rejected[0].reason).toBe("ownership");
    });
  });

  describe("pull", () => {
    it("repeated pull with same cursor returns identical server changes", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);
      // Sync once to establish cursor.
      const first = await service.syncBatch(pushRequest([], 0), userA);
      const cursor = first.syncRevision;

      // Simulate a second device's change.
      await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T00:00:00.000Z",
            payload: workoutPayload({ name: "V2" })
          })
        ]),
        userA
      );

      const a = await service.syncBatch(pushRequest([], cursor), userA);
      const b = await service.syncBatch(pushRequest([], cursor), userA);
      expect(a.serverChanges).toEqual(b.serverChanges);
      expect(a.serverChanges.workouts).toHaveLength(1);
      expect(a.serverChanges.workouts[0].payload?.name).toBe("V2");
    });

    it("cursor advancement: new revision moves the pull cursor forward", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      const initial = await service.syncBatch(pushRequest([], 0), userA);
      expect(initial.syncRevision).toBe(0); // no changes recorded yet

      await service.syncBatch(
        pushRequest([
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T00:00:00.000Z",
            payload: workoutPayload()
          })
        ]),
        userA
      );
      const after = await service.syncBatch(pushRequest([], 0), userA);
      expect(after.syncRevision).toBeGreaterThan(0);

      const inc = await service.syncBatch(pushRequest([], after.syncRevision), userA);
      expect(inc.syncRevision).toBe(after.syncRevision); // no newer changes
      expect(inc.serverChanges.workouts).toHaveLength(0);
    });

    it("tombstone propagation: offline device learns of a delete on next pull", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      const { service } = makeService(db);

      // Device A syncs (cursor 0) and notes its cursor.
      const a = await service.syncBatch(pushRequest([], 0), userA);
      const cursorA = a.syncRevision;

      // Device B deletes the workout.
      await service.syncBatch(
        pushRequest([
          item({
            op: "delete",
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T00:00:00.000Z",
            payload: null
          })
        ]),
        userA
      );

      // Device A pulls → sees tombstone.
      const pull = await service.syncBatch(pushRequest([], cursorA), userA);
      expect(pull.serverChanges.workouts).toHaveLength(1);
      expect(pull.serverChanges.workouts[0].op).toBe("delete");
      expect(pull.serverChanges.workouts[0].id).toBe("w1");
      // Device A's cursor advances past the tombstone.
      expect(pull.syncRevision).toBeGreaterThan(cursorA);

      // Repeated pull with new cursor → no duplicate tombstones.
      const again = await service.syncBatch(pushRequest([], pull.syncRevision), userA);
      expect(again.serverChanges.workouts).toHaveLength(0);
    });

    it("full initial sync returns every entity for the user", async () => {
      const db = createMemoryDb();
      seedWorkout(db);
      db.tables.workout_template_exercises.set("te1", {
        id: "te1",
        templateId: "t-plate",
        userId: userA.id,
        name: "Squat",
        orderIndex: 0,
        exerciseId: null,
        notes: null,
        restSeconds: null,
        revision: 1,
        clientUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        isDeleted: false,
        deletedAt: null,
        deletedBy: null
      } as WorkoutTemplateExercise);
      db.tables.workout_templates.set("t-plate", {
        id: "t-plate",
        userId: userA.id,
        name: "A",
        revision: 1,
        clientUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        isDeleted: false,
        deletedAt: null,
        deletedBy: null
      } as WorkoutTemplate);

      const { service } = makeService(db);
      const res = await service.syncBatch(pushRequest([], 0), userA);
      expect(res.serverChanges.workouts).toHaveLength(1);
      expect(res.serverChanges.templateExercises).toHaveLength(1);
      expect(res.serverChanges.workouts[0].payload?.name).toBe("Leg Day");
    });
  });

  describe("retries & transactions", () => {
    it("retry after failure: client retains local data and can re-sync", async () => {
      const db = createMemoryDb();
      const { service } = makeService(db);
      const dto = pushRequest([
        item({
          id: "w1",
          revision: 1,
          clientUpdatedAt: "2026-01-01T00:00:00.000Z",
          payload: workoutPayload()
        })
      ]);

      const first = await service.syncBatch(dto, userA);
      expect(first.accepted).toHaveLength(1);

      // Simulate a network-level retry with the same payload (duplicate).
      const retry = await service.syncBatch(dto, userA);
      expect(retry.accepted).toHaveLength(1);
      expect(retry.conflicts).toEqual([]);
      // No duplicate rows, no double effects.
      expect(db.tables.workouts.size).toBe(1);
      expect(db.tables.sync_changes.size).toBe(1);
    });

    it("partial failure: valid change accepted, invalid change rejected, both in one transaction", async () => {
      const db = createMemoryDb();
      seedWorkout(db, { id: "wB", userId: userB.id, name: "B's" });
      const { service, qr } = makeService(db);

      const res = await service.syncBatch(
        {
          lastSyncRevision: 0,
          clientId: "client-1",
          changes: {
            workouts: [
              item({
                id: "w1",
                revision: 2,
                clientUpdatedAt: "2026-01-02T00:00:00.000Z",
                payload: workoutPayload({ name: "Mine" })
              }),
              item({
                id: "wB",
                revision: 2,
                clientUpdatedAt: "2026-01-02T00:00:00.000Z",
                payload: workoutPayload({ id: "wB", name: "Not Mine" })
              })
            ]
          }
        },
        userA
      );

      expect(res.accepted).toEqual([{ entityType: "workout", id: "w1", revision: 2 }]);
      expect(res.rejected).toEqual([{ entityType: "workout", id: "wB", reason: "ownership" }]);
      expect(qr.commitTransaction).toHaveBeenCalled();
      expect(qr.rollbackTransaction).not.toHaveBeenCalled();
    });

    it("transaction rollback on unexpected error releases the query runner", async () => {
      const db = createMemoryDb();
      const manager = makeManager(db);
      const qr: MockQueryRunner = {
        manager,
        connect: jest.fn(() => Promise.resolve()),
        startTransaction: jest.fn(() => Promise.resolve()),
        commitTransaction: jest.fn(() => Promise.resolve()),
        rollbackTransaction: jest.fn(() => Promise.resolve()),
        release: jest.fn(() => Promise.resolve())
      };
      // Force findOne to throw on the first call (during applyWorkoutChange).
      const originalFindOne = (EC: unknown, opts?: { where?: Row }) => manager.findOne(EC, opts);
      let calls = 0;
      manager.findOne = (EC: unknown, opts?: { where?: Row }) => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return originalFindOne(EC, opts);
      };
      const dataSource = { createQueryRunner: () => qr } as unknown as DataSource;
      const service = new SyncService(noRepo<UserSyncState>(), noRepo<SyncChange>(), dataSource, makeWorkoutService(), makeWorkoutTemplateService(), noProgressQueue());

      await expect(service.syncBatch(pushRequest([item({ id: "w1", revision: 1, payload: workoutPayload() })]), userA)).rejects.toThrow("boom");
      expect(qr.rollbackTransaction).toHaveBeenCalled();
      expect(qr.release).toHaveBeenCalled();
    });
  });
});
