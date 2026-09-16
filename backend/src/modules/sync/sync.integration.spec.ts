/**
 * Phase 2 — Hardened sync integration tests.
 *
 * Validates the entire synchronization system against realistic multi-device
 * scenarios using an in-memory store that mirrors PostgreSQL semantics for the
 * pieces that matter to sync correctness:
 *
 *   • append-only sync_changes log with a monotonic SERIAL cursor
 *   • unique constraint on user_sync_state.user_id
 *   • per-request query runner (transaction isolation)
 *   • soft-delete tombstones on all domain tables
 *   • connection accounting (connect/release parity)
 *
 * Scenarios 1–8 follow the Phase 2 brief exactly, followed by concurrency and
 * infrastructure inspection tests.
 */

import { DataSource, FindOperator, ObjectLiteral, Repository } from "typeorm";
import { readFileSync } from "fs";
import { join } from "path";
import { SyncService, MAX_BATCH_ITEMS } from "./sync.service";
import { Workout } from "../workouts/entities/workout.entity";
import { WorkoutExercise } from "../workouts/entities/workout-exercise.entity";
import { Set } from "../workouts/entities/set.entity";
import { Exercise } from "../exercise/entities/exercise.entity";
import { UserTemplate } from "../workouts/entities/user-template.entity";
import { UserTemplateExercise } from "../workouts/entities/user-template-exercise.entity";
import { UserTemplateSet } from "../workouts/entities/user-template-set.entity";
import { UserSyncState } from "./entities/user-sync-state.entity";
import { SyncChange } from "./entities/sync-change.entity";
import { SyncBatchRequestDto, SyncBatchChangesDto, SyncChangeItemDto } from "./dto/sync-batch.dto";
import { User } from "../users/entities/user.entity";

type TableKey = "workouts" | "workout_exercises" | "sets" | "user_templates" | "user_template_exercises" | "user_template_sets" | "user_sync_state" | "sync_changes" | "exercises";

type AnyEntity = Workout | WorkoutExercise | Set | UserTemplate | UserTemplateExercise | UserTemplateSet | UserSyncState | SyncChange | Exercise;
type Row = Record<string, unknown>;

const OWN_ALIAS: Record<TableKey, string> = {
  workouts: "w",
  workout_exercises: "we",
  sets: "s",
  user_templates: "t",
  user_template_exercises: "te",
  user_template_sets: "ts",
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
  user_templates: Map<string, UserTemplate>;
  user_template_exercises: Map<string, UserTemplateExercise>;
  user_template_sets: Map<string, UserTemplateSet>;
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
      user_templates: new Map(),
      user_template_exercises: new Map(),
      user_template_sets: new Map(),
      user_sync_state: new Map(),
      sync_changes: new Map(),
      exercises: new Map()
    },
    nextChangeId: 1
  };
}

function tableStore(tables: TableStore, key: TableKey): Map<string, AnyEntity> {
  switch (key) {
    case "workouts":
      return tables.workouts as unknown as Map<string, AnyEntity>;
    case "workout_exercises":
      return tables.workout_exercises as unknown as Map<string, AnyEntity>;
    case "sets":
      return tables.sets as unknown as Map<string, AnyEntity>;
    case "user_templates":
      return tables.user_templates as unknown as Map<string, AnyEntity>;
    case "user_template_exercises":
      return tables.user_template_exercises as unknown as Map<string, AnyEntity>;
    case "user_template_sets":
      return tables.user_template_sets as unknown as Map<string, AnyEntity>;
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
  if (EC === UserTemplate) return "user_templates";
  if (EC === UserTemplateExercise) return "user_template_exercises";
  if (EC === UserTemplateSet) return "user_template_sets";
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

type WhereClause = { alias: string; col: string; prop: string; op: "in" | "eq" | "moreThan"; values: unknown[]; value: unknown };

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
      this.clauses.push({ alias, col, prop: COL_TO_PROP[col] ?? col, op: "in", values: (params[paramName] as unknown[]) ?? [], value: undefined });
      return this;
    }
    const eqMatch = cond.match(/^([a-z_]+)\.([a-z_]+) = :([a-zA-Z]+)$/);
    if (eqMatch) {
      const [, alias, col, paramName] = eqMatch;
      this.clauses.push({ alias, col, prop: COL_TO_PROP[col] ?? col, op: "eq", values: [], value: params[paramName] });
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
      const insertRow = (entityClass: unknown, row: Row): Promise<void> => makeManager(db).insert(entityClass, row);
      for (const row of rows) {
        const target = [...store.values()].find((r) => conflictPaths.every((p) => asRow(r)[p] === row[p]));
        if (target) {
          Object.assign(target, row);
        } else {
          void insertRow(EC, row);
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

interface ConnectionAccounting {
  connects: number;
  releases: number;
  started: number;
  committed: number;
  rolledBack: number;
  activeTransactions: number;
}

/** Fresh query runner each call, mirroring TypeORM connection pool semantics. */
function makeDataSource(db: MemoryDb) {
  const accounting: ConnectionAccounting = { connects: 0, releases: 0, started: 0, committed: 0, rolledBack: 0, activeTransactions: 0 };

  const createQueryRunner = () => {
    const manager = makeManager(db);
    return {
      manager,
      connect: (): Promise<void> => {
        accounting.connects += 1;
        return Promise.resolve();
      },
      startTransaction: (): Promise<void> => {
        accounting.started += 1;
        accounting.activeTransactions += 1;
        return Promise.resolve();
      },
      commitTransaction: (): Promise<void> => {
        accounting.committed += 1;
        accounting.activeTransactions -= 1;
        return Promise.resolve();
      },
      rollbackTransaction: (): Promise<void> => {
        accounting.rolledBack += 1;
        accounting.activeTransactions -= 1;
        return Promise.resolve();
      },
      release: (): Promise<void> => {
        accounting.releases += 1;
        return Promise.resolve();
      }
    };
  };

  const dataSource = { createQueryRunner } as unknown as DataSource;
  return { dataSource, accounting };
}

function makeService(db: MemoryDb): { service: SyncService; dataSource: DataSource; accounting: ConnectionAccounting } {
  const { dataSource, accounting } = makeDataSource(db);
  const service = new SyncService(
    noRepo<Workout>(),
    noRepo<WorkoutExercise>(),
    noRepo<Set>(),
    noRepo<UserTemplate>(),
    noRepo<UserTemplateExercise>(),
    noRepo<UserTemplateSet>(),
    noRepo<UserSyncState>(),
    noRepo<SyncChange>(),
    dataSource
  );
  return { service, dataSource, accounting };
}

function noRepo<T extends ObjectLiteral>(): Repository<T> {
  return {} as unknown as Repository<T>;
}

const userA = { id: "aaaa", email: "a@test.com" } as User;
const userB = { id: "bbbb", email: "b@test.com" } as User;

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const DEVICE_C = "33333333-3333-4333-8333-333333333333";

const item = (partial: Partial<SyncChangeItemDto> & { id: string }): SyncChangeItemDto => ({
  op: "upsert",
  revision: 1,
  clientUpdatedAt: "2026-01-01T00:00:00.000Z",
  payload: {},
  ...partial
});

const workoutPayload = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "Leg Day",
  notes: null,
  startedAt: "2026-01-01T08:00:00.000Z",
  endedAt: null,
  durationSeconds: null,
  ...over
});

function seedWorkout(db: MemoryDb, id: string, over: Partial<Workout> = {}): void {
  const row = {
    id,
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

function workoutChanges(workouts: SyncChangeItemDto[]): SyncBatchChangesDto {
  return { workouts };
}

function pushRequest(workouts: SyncChangeItemDto[], lastSyncRevision = 0, clientId = DEVICE_A): SyncBatchRequestDto {
  return { lastSyncRevision, clientId, changes: workoutChanges(workouts) };
}

/** Count rows where a predicate holds. */
function countOf<T>(store: Map<string, T>, pred: (r: T) => boolean): number {
  let n = 0;
  for (const row of store.values()) if (pred(row)) n += 1;
  return n;
}

async function syncWithCatch(service: SyncService, dto: SyncBatchRequestDto, user: User) {
  try {
    const res = await service.syncBatch(dto, user);
    return { ok: true as const, res };
  } catch (e: unknown) {
    return { ok: false as const, err: e };
  }
}

// ─── Scenario 1: offline creates from two devices both survive ─────────────

describe("Scenario 1 — multi-device offline creates survive", () => {
  it("device A and device B create distinct workouts offline; both persist after syncing in any order", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const workoutA = item({
      id: "w-a",
      revision: 1,
      clientUpdatedAt: "2026-01-01T09:00:00.000Z",
      payload: workoutPayload("w-a", { name: "Offline A" })
    });
    const workoutB = item({
      id: "w-b",
      revision: 1,
      clientUpdatedAt: "2026-01-01T09:05:00.000Z",
      payload: workoutPayload("w-b", { name: "Offline B" })
    });

    await service.syncBatch(pushRequest([workoutA], 0, DEVICE_A), userA);
    const resB = await service.syncBatch(pushRequest([workoutB], 0, DEVICE_B), userA);

    expect(resB.accepted).toHaveLength(1);
    expect(resB.rejected).toEqual([]);
    expect(db.tables.workouts.has("w-a")).toBe(true);
    expect(db.tables.workouts.has("w-b")).toBe(true);
    expect(db.tables.workouts.get("w-a")!.name).toBe("Offline A");
    expect(db.tables.workouts.get("w-b")!.name).toBe("Offline B");

    const pullForB = await service.syncBatch(pushRequest([], 0, DEVICE_B), userA);
    const names = pullForB.serverChanges.workouts.map((w) => (w.payload as Record<string, unknown> | null)?.name);
    expect(names).toEqual(expect.arrayContaining(["Offline A", "Offline B"]));

    expect(countOf(db.tables.sync_changes, (c) => c.entityId === "w-a")).toBe(1);
    expect(countOf(db.tables.sync_changes, (c) => c.entityId === "w-b")).toBe(1);
  });

  it("full workout trees (workout + exercises + sets) from both devices survive", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const buildTree = (prefix: string, ts: string): { workouts: SyncChangeItemDto[]; workoutExercises: SyncChangeItemDto[]; sets: SyncChangeItemDto[] } => ({
      workouts: [item({ id: `${prefix}-w`, revision: 1, clientUpdatedAt: ts, payload: workoutPayload(`${prefix}-w`, { name: `${prefix} Workout` }) })],
      workoutExercises: [
        item({
          id: `${prefix}-we`,
          revision: 1,
          clientUpdatedAt: ts,
          payload: { id: `${prefix}-we`, workoutId: `${prefix}-w`, exerciseId: "ex-squat", name: "Squat", orderIndex: 0, notes: null, restSeconds: 90 }
        })
      ],
      sets: [
        item({
          id: `${prefix}-s`,
          revision: 1,
          clientUpdatedAt: ts,
          payload: { id: `${prefix}-s`, workoutExerciseId: `${prefix}-we`, orderIndex: 0, weight: 100, reps: 5, rpe: 8, isWarmup: false, isDropset: false, isFailure: false }
        })
      ]
    });

    const treeA = buildTree("a", "2026-01-01T09:00:00.000Z");
    const treeB = buildTree("b", "2026-01-01T09:10:00.000Z");

    await service.syncBatch({ lastSyncRevision: 0, clientId: DEVICE_A, changes: treeA }, userA);
    const res = await service.syncBatch({ lastSyncRevision: 0, clientId: DEVICE_B, changes: treeB }, userA);

    expect(res.rejected).toEqual([]);
    expect(db.tables.workouts.has("a-w")).toBe(true);
    expect(db.tables.workouts.has("b-w")).toBe(true);
    expect(db.tables.workout_exercises.has("a-we")).toBe(true);
    expect(db.tables.workout_exercises.has("b-we")).toBe(true);
    expect(db.tables.sets.has("a-s")).toBe(true);
    expect(db.tables.sets.has("b-s")).toBe(true);
  });
});

// ─── Scenario 2: concurrent edits resolve deterministically ────────────────

describe("Scenario 2 — concurrent edits resolve deterministically", () => {
  it("device B syncs first, device A syncs later; newer clientUpdatedAt wins deterministically", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1", { revision: 1, clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z") });
    const { service } = makeService(db);

    const editA = item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "Edits from A" }) });
    const editB = item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-03T00:00:00.000Z", payload: workoutPayload("w1", { name: "Edits from B" }) });

    const resB = await service.syncBatch(pushRequest([editB], 0, DEVICE_B), userA);
    expect(resB.accepted[0].revision).toBe(2);

    // A syncs later with an older timestamp → server (B) wins, conflict reported.
    const resA = await service.syncBatch(pushRequest([editA], 0, DEVICE_A), userA);
    expect(resA.conflicts).toHaveLength(1);
    expect(resA.conflicts[0].resolvedWith).toBe("server");
    expect(db.tables.workouts.get("w1")!.name).toBe("Edits from B");
    expect(db.tables.workouts.get("w1")!.clientUpdatedAt!.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("result is independent of sync arrival order (deterministic LWW)", async () => {
    const run = async (order: "A-first" | "B-first") => {
      const db = createMemoryDb();
      seedWorkout(db, "w1", { revision: 1, clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z") });
      const { service } = makeService(db);

      const editA = item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "A" }) });
      const editB = item({ id: "w1", revision: 3, clientUpdatedAt: "2026-01-03T00:00:00.000Z", payload: workoutPayload("w1", { name: "B" }) });

      if (order === "A-first") {
        await service.syncBatch(pushRequest([editA], 0, DEVICE_A), userA);
        await service.syncBatch(pushRequest([editB], 0, DEVICE_B), userA);
      } else {
        await service.syncBatch(pushRequest([editB], 0, DEVICE_B), userA);
        await service.syncBatch(pushRequest([editA], 0, DEVICE_A), userA);
      }

      return { name: db.tables.workouts.get("w1")!.name, clientUpdatedAt: db.tables.workouts.get("w1")!.clientUpdatedAt!.toISOString() };
    };

    const forward = await run("A-first");
    const reverse = await run("B-first");
    expect(forward).toEqual({ name: "B", clientUpdatedAt: "2026-01-03T00:00:00.000Z" });
    expect(reverse).toEqual(forward);
  });
});

// ─── Scenario 3: edit vs delete, any arrival order, deterministic ──────────

describe("Scenario 3 — edit vs delete resolve deterministically", () => {
  it("newer delete beats older edit; final deleted state is identical in any arrival order", async () => {
    const run = async (order: "delete-first" | "edit-first") => {
      const db = createMemoryDb();
      seedWorkout(db, "w1", { revision: 1, clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z") });
      const { service } = makeService(db);

      const edit = item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "Edit" }) });
      const del = item({ id: "w1", op: "delete", revision: 2, clientUpdatedAt: "2026-01-04T00:00:00.000Z", payload: null });

      if (order === "delete-first") {
        await service.syncBatch(pushRequest([del], 0, DEVICE_B), userA);
        const res = await service.syncBatch(pushRequest([edit], 0, DEVICE_A), userA);
        return { deleted: db.tables.workouts.get("w1")!.isDeleted, res };
      }
      await service.syncBatch(pushRequest([edit], 0, DEVICE_A), userA);
      const res = await service.syncBatch(pushRequest([del], 0, DEVICE_B), userA);
      return { deleted: db.tables.workouts.get("w1")!.isDeleted, res };
    };

    // Final state is deterministic regardless of arrival order.
    const deleteFirst = await run("delete-first");
    const editFirst = await run("edit-first");
    expect(deleteFirst.deleted).toBe(true);
    expect(editFirst.deleted).toBe(true);

    // When the delete lands first, the stale edit is overridden by the server
    // and must be surfaced as a conflict (distinct logical op, not a replay).
    expect(deleteFirst.res.conflicts).toHaveLength(1);
    expect(deleteFirst.res.conflicts[0].resolvedWith).toBe("server");

    // Tombstone metadata is persisted.
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);
    await service.syncBatch(pushRequest([item({ id: "w1", op: "delete", revision: 2, clientUpdatedAt: "2026-01-04T00:00:00.000Z", payload: null })], 0, DEVICE_B), userA);
    expect(db.tables.workouts.get("w1")!.deletedBy).toBe(userA.id);
  });

  it("newer edit beats older delete (deleted state is resurrected)", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1", {
      isDeleted: true,
      deletedAt: new Date("2026-01-01T12:00:00.000Z"),
      deletedBy: userA.id,
      revision: 2,
      clientUpdatedAt: new Date("2026-01-01T12:00:00.000Z")
    });
    const { service } = makeService(db);

    const res = await service.syncBatch(
      pushRequest([item({ id: "w1", revision: 3, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "Resurrected" }) })], 0, DEVICE_A),
      userA
    );

    expect(res.rejected).toEqual([]);
    const stored = db.tables.workouts.get("w1")!;
    expect(stored.isDeleted).toBe(false);
    expect(stored.deletedAt).toBeNull();
    expect(stored.name).toBe("Resurrected");
  });

  it("repeated deletion keeps the entity deleted and stays deduplicated on pull", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);

    const del = (rev: number, ts: string) => item({ id: "w1", op: "delete", revision: rev, clientUpdatedAt: ts, payload: null });

    // First sync pushes an unrelated workout so the cursor advances past 0,
    // forcing the incremental pull path (NOT the full bootstrap snapshot).
    const initial = await service.syncBatch(
      pushRequest([item({ id: "w0", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w0", { name: "Seed" }) })], 0, DEVICE_A),
      userA
    );
    const cursor = initial.syncRevision;

    // Two devices independently delete the same workout.
    await service.syncBatch(pushRequest([del(2, "2026-01-02T00:00:00.000Z")], 0, DEVICE_A), userA);
    await service.syncBatch(pushRequest([del(3, "2026-01-03T00:00:00.000Z")], 0, DEVICE_B), userA);
    expect(db.tables.workouts.get("w1")!.isDeleted).toBe(true);

    // A device pulling past the burst receives exactly ONE deduplicated tombstone.
    const pull = await service.syncBatch(pushRequest([], cursor, DEVICE_C), userA);
    const deletedEntries = pull.serverChanges.workouts.filter((w) => w.op === "delete");
    expect(deletedEntries).toHaveLength(1);
    expect(deletedEntries[0].id).toBe("w1");
    expect(pull.syncRevision).toBe(cursor + 2);
  });
});

// ─── Scenario 4: same batch submitted twice → idempotent ───────────────────

describe("Scenario 4 — duplicate batch submission is idempotent", () => {
  it("re-sending an identical batch creates no duplicates and no side effects", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const dto = pushRequest([item({ id: "w1", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w1", { name: "Once" }) })], 0, DEVICE_A);

    const first = await service.syncBatch(dto, userA);
    const second = await service.syncBatch(dto, userA);

    expect(first.accepted).toHaveLength(1);
    expect(second.conflicts).toEqual([]);
    expect(second.rejected).toEqual([]);
    expect(db.tables.workouts.size).toBe(1);
    expect(db.tables.sync_changes.size).toBe(1);
    expect(db.tables.workouts.get("w1")!.revision).toBe(1);
    expect(db.tables.workouts.get("w1")!.name).toBe("Once");

    const pull = await service.syncBatch(pushRequest([], second.syncRevision, DEVICE_A), userA);
    expect(pull.serverChanges.workouts).toHaveLength(0);
  });

  it("same entity revision from two devices coalesces into a single change record", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);

    const dto = pushRequest([item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "V2" }) })], 0, DEVICE_A);
    await service.syncBatch(dto, userA);
    const res = await service.syncBatch(dto, userA);

    expect(res.conflicts).toEqual([]);
    expect(countOf(db.tables.sync_changes, (c) => c.entityType === "workout" && c.entityId === "w1")).toBe(1);
    expect(db.tables.sync_changes.size).toBe(1);
  });
});

// ─── Scenario 5: partial failure + retry stays idempotent ──────────────────

describe("Scenario 5 — partial failure then retry stays idempotent", () => {
  it("a partially-failing batch commits the valid part; retrying the whole batch is safe", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id, name: "B's" });
    const { service } = makeService(db);

    const dto: SyncBatchRequestDto = {
      lastSyncRevision: 0,
      clientId: DEVICE_A,
      changes: {
        workouts: [
          item({ id: "w-a", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w-a", { name: "A new" }) }),
          item({ id: "wB", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("wB", { name: "Hijack" }) })
        ]
      }
    };

    const first = await service.syncBatch(dto, userA);
    expect(first.accepted).toEqual([{ entityType: "workout", id: "w-a", revision: 1 }]);
    expect(first.rejected).toEqual([{ entityType: "workout", id: "wB", reason: "ownership" }]);
    expect(db.tables.workouts.has("w-a")).toBe(true);
    expect(db.tables.workouts.get("wB")!.name).toBe("B's");

    const retry = await service.syncBatch(dto, userA);
    expect(retry.accepted).toHaveLength(1);
    expect(retry.rejected).toEqual([{ entityType: "workout", id: "wB", reason: "ownership" }]);
    expect(countOf(db.tables.workouts, () => true)).toBe(2);
    expect(countOf(db.tables.sync_changes, (c) => c.entityType === "workout" && c.entityId === "w-a")).toBe(1);
  });

  it("a hard error rolls back the whole transaction; nothing is half-applied", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { dataSource, accounting } = makeDataSource(db);

    let armed = false;
    const ds = dataSource as unknown as {
      createQueryRunner: () => {
        manager: MockManager;
        connect(): Promise<void>;
        startTransaction(): Promise<void>;
        commitTransaction(): Promise<void>;
        rollbackTransaction(): Promise<void>;
        release(): Promise<void>;
      };
    };
    const originalImpl = ds.createQueryRunner;
    ds.createQueryRunner = () => {
      const qr = originalImpl();
      const manager = qr.manager;
      const origFindOne: (EC: unknown, opts?: { where?: Row }) => Promise<AnyEntity | null> = (EC, opts) => manager.findOne(EC, opts);
      manager.findOne = (EC: unknown, opts?: { where?: Row }) => {
        if (armed && EC === Workout && opts?.where?.id === "w1") {
          return Promise.reject(new Error("db connection lost"));
        }
        return origFindOne(EC, opts);
      };
      return qr;
    };

    const service = new SyncService(
      noRepo<Workout>(),
      noRepo<WorkoutExercise>(),
      noRepo<Set>(),
      noRepo<UserTemplate>(),
      noRepo<UserTemplateExercise>(),
      noRepo<UserTemplateSet>(),
      noRepo<UserSyncState>(),
      noRepo<SyncChange>(),
      dataSource
    );

    armed = true;
    const dto = pushRequest(
      [item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "Should not persist" }) })],
      0,
      DEVICE_A
    );
    await expect(service.syncBatch(dto, userA)).rejects.toThrow("db connection lost");

    expect(db.tables.workouts.get("w1")!.name).toBe("Leg Day");
    expect(db.tables.workouts.get("w1")!.revision).toBe(1);
    expect(db.tables.sync_changes.size).toBe(0);

    expect(accounting.rolledBack).toBe(1);
    expect(accounting.releases).toBe(accounting.connects);
    expect(accounting.activeTransactions).toBe(0);
  });
});

// ─── Scenario 6: repeated pull with the same cursor is consistent ──────────

describe("Scenario 6 — repeated pull with same cursor is consistent", () => {
  it("two identical pulls with the same cursor return identical server changes", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);

    await service.syncBatch(
      pushRequest([item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "Pulled" }) })], 0, DEVICE_A),
      userA
    );

    const first = await service.syncBatch(pushRequest([], 0, DEVICE_B), userA);
    const second = await service.syncBatch(pushRequest([], 0, DEVICE_B), userA);

    expect(first.serverChanges).toEqual(second.serverChanges);
    expect(first.syncRevision).toBe(second.syncRevision);
    expect(first.serverChanges.workouts).toHaveLength(1);
    expect(first.serverChanges.workouts[0].payload?.name).toBe("Pulled");
  });

  it("an incremental pull after a duplicate push does not replay or duplicate rows", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);

    const cursorAfterInitial = (await service.syncBatch(pushRequest([], 0, DEVICE_A), userA)).syncRevision;

    const update = pushRequest(
      [item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "V2" }) })],
      cursorAfterInitial,
      DEVICE_A
    );
    const res = await service.syncBatch(update, userA);
    const newCursor = res.syncRevision;

    // Pull at the exact new cursor → nothing new.
    const empty = await service.syncBatch(pushRequest([], newCursor, DEVICE_B), userA);
    expect(empty.serverChanges.workouts).toHaveLength(0);

    // Pull at the previous cursor → exactly the single latest state, once.
    const delta = await service.syncBatch(pushRequest([], cursorAfterInitial, DEVICE_B), userA);
    expect(delta.serverChanges.workouts).toHaveLength(1);
    expect(delta.serverChanges.workouts[0].revision).toBe(2);
    expect(delta.syncRevision).toBe(newCursor);
  });
});

// ─── Scenario 7: large sync batches — limits and performance ───────────────

describe("Scenario 7 — large sync batch limits and performance", () => {
  it(`accepts exactly ${MAX_BATCH_ITEMS} items`, async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const workouts = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) =>
      item({
        id: `w-${String(i).padStart(4, "0")}`,
        revision: 1,
        clientUpdatedAt: "2026-01-01T10:00:00.000Z",
        payload: workoutPayload(`w-${String(i).padStart(4, "0")}`, { name: `W${i}` })
      })
    );

    const res = await service.syncBatch(pushRequest(workouts, 0, DEVICE_A), userA);
    expect(res.rejected).toEqual([]);
    expect(res.accepted).toHaveLength(MAX_BATCH_ITEMS);
    expect(countOf(db.tables.workouts, () => true)).toBe(MAX_BATCH_ITEMS);
    expect(countOf(db.tables.sync_changes, () => true)).toBe(MAX_BATCH_ITEMS);
  });

  it(`rejects batches over ${MAX_BATCH_ITEMS} items`, async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const workouts = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) =>
      item({
        id: `w-${String(i).padStart(4, "0")}`,
        revision: 1,
        clientUpdatedAt: "2026-01-01T10:00:00.000Z",
        payload: workoutPayload(`w-${String(i).padStart(4, "0")}`)
      })
    );

    const res = await syncWithCatch(service, pushRequest(workouts, 0, DEVICE_A), userA);
    expect(res.ok).toBe(false);
    expect(db.tables.workouts.size).toBe(0);
    expect(db.tables.sync_changes.size).toBe(0);
  });

  it("aggregates the limit across entity families", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const workouts = Array.from({ length: MAX_BATCH_ITEMS }, (_, i) =>
      item({ id: `w-${i}`, revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload(`w-${i}`) })
    );
    const extra = item({ id: "w-extra", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w-extra") });

    const res = await syncWithCatch(service, pushRequest([...workouts, extra], 0, DEVICE_A), userA);
    expect(res.ok).toBe(false);
  });

  it("processes a large batch within a bounded time budget", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const workouts = Array.from({ length: 200 }, (_, i) =>
      item({
        id: `perf-${String(i).padStart(4, "0")}`,
        revision: 1,
        clientUpdatedAt: "2026-01-01T10:00:00.000Z",
        payload: workoutPayload(`perf-${String(i).padStart(4, "0")}`, { name: `Perf ${i}` })
      })
    );

    const start = Date.now();
    const res = await service.syncBatch(pushRequest(workouts, 0, DEVICE_A), userA);
    const elapsed = Date.now() - start;

    expect(res.accepted).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  });

  it("a large pull is deduplicated so the client receives one entry per changed entity", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "w1");
    const { service } = makeService(db);

    // Establish a non-zero cursor first (ids 1..N exist before the burst).
    const baseline = await service.syncBatch(
      pushRequest(
        [
          item({
            id: "w1",
            revision: 2,
            clientUpdatedAt: "2026-01-02T10:00:00.000Z",
            payload: workoutPayload("w1", { name: "Baseline" })
          })
        ],
        0,
        DEVICE_A
      ),
      userA
    );
    const cursor = baseline.syncRevision;

    // Burst of 50 more mutations to the SAME entity → 50 change-log rows.
    for (let rev = 3; rev <= 52; rev += 1) {
      await service.syncBatch(
        pushRequest(
          [
            item({
              id: "w1",
              revision: rev,
              clientUpdatedAt: new Date(Date.UTC(2026, 1, rev)).toISOString(),
              payload: workoutPayload("w1", { name: `Rev ${rev}` })
            })
          ],
          0,
          DEVICE_A
        ),
        userA
      );
    }

    // Incremental pull from the pre-burst cursor: 50 log rows, deduped to 1.
    const pull = await service.syncBatch(pushRequest([], cursor, DEVICE_B), userA);
    expect(pull.serverChanges.workouts).toHaveLength(1);
    expect(pull.serverChanges.workouts[0].payload?.name).toBe("Rev 52");
    expect(pull.syncRevision).toBe(cursor + 50);
  });

  it("incremental pull only returns changes after the cursor even when many exist", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const before = await service.syncBatch(pushRequest([], 0, DEVICE_A), userA);
    const cursor = before.syncRevision;

    for (let i = 0; i < 40; i += 1) {
      await service.syncBatch(
        pushRequest([item({ id: `mid-${i}`, revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload(`mid-${i}`) })], 0, DEVICE_A),
        userA
      );
    }

    const delta = await service.syncBatch(pushRequest([], cursor, DEVICE_B), userA);
    expect(delta.serverChanges.workouts).toHaveLength(40);
    expect(delta.syncRevision).toBe(cursor + 40);
  });
});

// ─── Scenario 8: unauthorized entity submission is rejected ────────────────

describe("Scenario 8 — unauthorized entity submission is rejected", () => {
  it("rejects upsert of a workout owned by another user", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id });
    const { service } = makeService(db);

    const res = await service.syncBatch(
      pushRequest([item({ id: "wB", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("wB", { name: "Stolen" }) })], 0, DEVICE_A),
      userA
    );

    expect(res.rejected).toEqual([{ entityType: "workout", id: "wB", reason: "ownership" }]);
    expect(db.tables.workouts.get("wB")!.name).toBe("Leg Day");
    expect(db.tables.sync_changes.size).toBe(0);
  });

  it("rejects delete of a workout owned by another user", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id });
    const { service } = makeService(db);

    const res = await service.syncBatch(
      pushRequest([item({ id: "wB", op: "delete", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: null })], 0, DEVICE_A),
      userA
    );

    expect(res.rejected[0].reason).toBe("ownership");
    expect(db.tables.workouts.get("wB")!.isDeleted).toBe(false);
  });

  it("rejects a workoutExercise when the parent workout belongs to another user", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id });
    db.tables.workout_exercises.set("weB", {
      id: "weB",
      workoutId: "wB",
      exerciseId: "ex1",
      orderIndex: 0,
      notes: null,
      restSeconds: null,
      name: "Squat",
      revision: 1,
      clientUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null
    } as WorkoutExercise);
    const { service } = makeService(db);

    const res = await service.syncBatch(
      {
        lastSyncRevision: 0,
        clientId: DEVICE_A,
        changes: {
          workoutExercises: [
            item({
              id: "weB",
              revision: 2,
              clientUpdatedAt: "2026-01-02T00:00:00.000Z",
              payload: { id: "weB", workoutId: "wB", exerciseId: "ex1", name: "Squat", orderIndex: 0 }
            })
          ]
        }
      },
      userA
    );

    expect(res.rejected[0].reason).toBe("ownership");
    expect(db.tables.workout_exercises.get("weB")!.orderIndex).toBe(0);
  });

  it("rejects a set chained to another user's workout through its exercise", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id });
    db.tables.workout_exercises.set("weB", {
      id: "weB",
      workoutId: "wB",
      exerciseId: "ex1",
      orderIndex: 0,
      notes: null,
      restSeconds: null,
      name: "Squat",
      revision: 1,
      clientUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      isDeleted: false,
      deletedAt: null,
      deletedBy: null
    } as WorkoutExercise);
    const { service } = makeService(db);

    const res = await service.syncBatch(
      {
        lastSyncRevision: 0,
        clientId: DEVICE_A,
        changes: {
          sets: [
            item({
              id: "sB",
              revision: 2,
              clientUpdatedAt: "2026-01-02T00:00:00.000Z",
              payload: { id: "sB", workoutExerciseId: "weB", orderIndex: 0, weight: 50, reps: 10 }
            })
          ]
        }
      },
      userA
    );

    expect(res.rejected[0].reason).toBe("ownership");
    expect(db.tables.sets.size).toBe(0);
  });

  it("rejects mutations of entities belonging to a different user in the same batch while keeping the valid ones", async () => {
    const db = createMemoryDb();
    seedWorkout(db, "wB", { userId: userB.id });
    const { service } = makeService(db);

    const dto: SyncBatchRequestDto = {
      lastSyncRevision: 0,
      clientId: DEVICE_A,
      changes: {
        workouts: [
          item({ id: "w-mine", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w-mine", { name: "Mine" }) }),
          item({ id: "wB", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("wB", { name: "HiJack" }) })
        ]
      }
    };

    const res = await service.syncBatch(dto, userA);
    expect(res.accepted).toEqual([{ entityType: "workout", id: "w-mine", revision: 1 }]);
    expect(res.rejected).toEqual([{ entityType: "workout", id: "wB", reason: "ownership" }]);
    expect(db.tables.workouts.has("w-mine")).toBe(true);
    expect(db.tables.workouts.get("wB")!.name).toBe("Leg Day");
  });
});

// ─── Concurrent database operations ────────────────────────────────────────

describe("Concurrent database operations", () => {
  it("parallel syncs for distinct entities all commit without data loss", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        service.syncBatch(
          pushRequest(
            [
              item({
                id: `w-${String(i).padStart(3, "0")}`,
                revision: 1,
                clientUpdatedAt: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
                payload: workoutPayload(`w-${String(i).padStart(3, "0")}`, { name: `W${i}` })
              })
            ],
            0,
            i % 2 === 0 ? DEVICE_A : DEVICE_B
          ),
          userA
        )
      )
    );

    expect(results.every((r) => r.rejected.length === 0 && r.accepted.length === 1)).toBe(true);
    expect(db.tables.workouts.size).toBe(50);
    expect(db.tables.sync_changes.size).toBe(50);
    // Exactly one cursor row survives.
    expect(db.tables.user_sync_state.size).toBe(1);
    // Cursor is monotonic (no interleaving gaps from racing serial inserts).
    const ids = [...db.tables.sync_changes.keys()].map(Number).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("parallel conflicting edits converge on the same deterministic winner as sequential execution", async () => {
    const runParallel = async () => {
      const db = createMemoryDb();
      seedWorkout(db, "w1", { revision: 1, clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z") });
      const { service } = makeService(db);

      const edits = [
        { id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "A" }) },
        { id: "w1", revision: 3, clientUpdatedAt: "2026-01-03T00:00:00.000Z", payload: workoutPayload("w1", { name: "B" }) },
        { id: "w1", revision: 4, clientUpdatedAt: "2026-01-04T00:00:00.000Z", payload: workoutPayload("w1", { name: "C" }) }
      ];
      await Promise.all(edits.map((e, i) => service.syncBatch(pushRequest([item(e)], 0, i % 2 === 0 ? DEVICE_A : DEVICE_B), userA)));

      const stored = db.tables.workouts.get("w1")!;
      return { name: stored.name, revision: stored.revision, clientUpdatedAt: stored.clientUpdatedAt!.toISOString() };
    };

    const parallelResult = await runParallel();

    // Sequential reference: C is the newest (revision 4, Jan 4).
    const db = createMemoryDb();
    seedWorkout(db, "w1", { revision: 1, clientUpdatedAt: new Date("2026-01-01T08:00:00.000Z") });
    const { service } = makeService(db);
    await service.syncBatch(
      pushRequest([item({ id: "w1", revision: 2, clientUpdatedAt: "2026-01-02T00:00:00.000Z", payload: workoutPayload("w1", { name: "A" }) })], 0, DEVICE_A),
      userA
    );
    await service.syncBatch(
      pushRequest([item({ id: "w1", revision: 3, clientUpdatedAt: "2026-01-03T00:00:00.000Z", payload: workoutPayload("w1", { name: "B" }) })], 0, DEVICE_B),
      userA
    );
    await service.syncBatch(
      pushRequest([item({ id: "w1", revision: 4, clientUpdatedAt: "2026-01-04T00:00:00.000Z", payload: workoutPayload("w1", { name: "C" }) })], 0, DEVICE_A),
      userA
    );
    const sequential = {
      name: db.tables.workouts.get("w1")!.name,
      revision: db.tables.workouts.get("w1")!.revision,
      clientUpdatedAt: db.tables.workouts.get("w1")!.clientUpdatedAt!.toISOString()
    };

    expect(parallelResult).toEqual({ name: "C", revision: 4, clientUpdatedAt: "2026-01-04T00:00:00.000Z" });
    expect(parallelResult).toEqual(sequential);
  });

  it("two concurrent first-time syncs do not violate the unique user_sync_state constraint and leave one row", async () => {
    const db = createMemoryDb();
    const { service } = makeService(db);

    // No pre-existing sync state: both devices race to create the row.
    await Promise.all([
      service.syncBatch(pushRequest([item({ id: "w-a", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w-a") })], 0, DEVICE_A), userA),
      service.syncBatch(pushRequest([item({ id: "w-b", revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload("w-b") })], 0, DEVICE_B), userA)
    ]);

    expect(db.tables.user_sync_state.size).toBe(1);
    const state = [...db.tables.user_sync_state.values()][0];
    expect(state.userId).toBe(userA.id);
    // Both workouts survived.
    expect(db.tables.workouts.size).toBe(2);
  });

  it("each concurrent sync runs in its own isolated transaction and releases its connection", async () => {
    const db = createMemoryDb();
    const { service, accounting } = makeService(db);

    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        service.syncBatch(pushRequest([item({ id: `c-${i}`, revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload(`c-${i}`) })], 0, DEVICE_A), userA)
      )
    );

    expect(accounting.connects).toBe(25);
    expect(accounting.started).toBe(25);
    expect(accounting.committed).toBe(25);
    expect(accounting.rolledBack).toBe(0);
    expect(accounting.releases).toBe(25);
    expect(accounting.activeTransactions).toBe(0);
  });
});

// ─── Infrastructure inspection ─────────────────────────────────────────────

describe("Infrastructure inspection", () => {
  describe("schema invariants (mirrored by the in-memory store)", () => {
    it("user_sync_state keeps exactly one cursor row per user (unique user_id)", async () => {
      const db = createMemoryDb();
      const { service } = makeService(db);

      // Repeated syncs from many devices must never grow the state table.
      for (let i = 0; i < 20; i += 1) {
        await service.syncBatch(
          pushRequest([item({ id: `w-${i}`, revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload(`w-${i}`) })], 0, i % 2 === 0 ? DEVICE_A : DEVICE_B),
          userA
        );
      }
      expect(db.tables.user_sync_state.size).toBe(1);
      const state = [...db.tables.user_sync_state.values()][0];
      expect(state.userId).toBe(userA.id);
      expect(state.syncRevision).toBe(20);
    });

    it("sync_changes is append-only and the pull cursor is its monotonic SERIAL id", async () => {
      const db = createMemoryDb();
      const { service } = makeService(db);

      let prevCursor = 0;
      for (let i = 0; i < 10; i += 1) {
        const res = await service.syncBatch(
          pushRequest([item({ id: `w-${i}`, revision: 1, clientUpdatedAt: "2026-01-01T10:00:00.000Z", payload: workoutPayload(`w-${i}`) })], 0, DEVICE_A),
          userA
        );
        expect(res.syncRevision).toBe(prevCursor + 1);
        prevCursor = res.syncRevision;
      }
      const ids = [...db.tables.sync_changes.keys()].map(Number).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe("migration guarantees", () => {
    it("offline-first migration creates unique user sync state and pull indexes", () => {
      const file = readFileSync(join(process.cwd(), "database/migrations/1772000000000-offline_first_sync.ts"), "utf8");
      expect(file).toContain('"user_id" uuid NOT NULL UNIQUE');
      expect(file).toContain("idx_workouts_user_updated");
      expect(file).toContain("idx_workout_exercises_updated");
      expect(file).toContain("idx_sets_updated");
      expect(file).toContain("idx_user_templates_user_id");
      expect(file).toContain("idx_user_templates_updated_at");
    });

    it("sync-changelog migration creates the pull-cursor and ownership indexes on sync_changes", () => {
      const file = readFileSync(join(process.cwd(), "database/migrations/1773000000000-sync_changelog.ts"), "utf8");
      expect(file).toContain("idx_sync_changes_user_cursor");
      expect(file).toContain("idx_sync_changes_user_entity");
      expect(file).toContain("idx_sync_changes_entity_id");
      expect(file).toContain("client_updated_at");
    });
  });

  describe("rate limiting", () => {
    it("the app enforces a global 10 req / 60s throttle", () => {
      const file = readFileSync(join(process.cwd(), "src/app.module.ts"), "utf8");
      expect(file).toContain("ttl: 60000");
      expect(file).toContain("limit: 10");
      expect(file).toContain("ThrottlerGuard");
    });
  });

  describe("request body size", () => {
    it("the app accepts JSON bodies beyond the 100kb express default to fit large sync batches", () => {
      const file = readFileSync(join(process.cwd(), "src/main.ts"), "utf8");
      expect(file).toContain("bodyParser: false");
      expect(file).toMatch(/json\(\{ limit: "5mb" \}\)/);
    });
  });
});
