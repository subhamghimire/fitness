/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { INestApplication, ValidationPipe, ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { getRepositoryToken } from "@nestjs/typeorm";
import { CoachDashboardController } from "./../src/modules/coach-dashboard/coach-dashboard.controller";
import { CoachDashboardService } from "./../src/modules/coach-dashboard/coach-dashboard.service";
import { CoachClientRelationship } from "./../src/modules/coach-client/entities/coach-client-relationship.entity";
import { RelationshipStatus } from "./../src/modules/coach-client/enums";
import { Coach } from "./../src/modules/coach/entities/coach.entity";
import { User } from "./../src/modules/users/entities/user.entity";
import { Program } from "./../src/modules/program/entities/program.entity";
import { ProgramDay } from "./../src/modules/program/entities/program-day.entity";
import { ProgramWorkout } from "./../src/modules/program/entities/program-workout.entity";
import { ProgramAssignment } from "./../src/modules/program/entities/program-assignment.entity";
import { ProgramAssignmentStatus } from "./../src/modules/program/enums/program.enum";
import { Workout } from "./../src/modules/workout/entities/workout.entity";
import { WorkoutStat } from "./../src/modules/progress/entities/workout-stat.entity";
import { WorkoutExerciseStat } from "./../src/modules/progress/entities/workout-exercise-stat.entity";
import { PersonalRecord } from "./../src/modules/progress/entities/personal-record.entity";
import { ExerciseStat } from "./../src/modules/progress/entities/exercise-stat.entity";
import { PersonalRecordType } from "./../src/modules/progress/enums/progress.enum";
import { ProgressService } from "./../src/modules/progress/progress.service";
import { JwtAuthGuard } from "./../src/modules/auth/guards/jwt-auth.guard";
import { FakeQueryBuilder, Row } from "./query-fake";

const USER_COACH_A = "10000000-0000-4000-8000-0000000000a1";
const USER_COACH_B = "10000000-0000-4000-8000-0000000000b1";
const USER_CLIENT_A = "10000000-0000-4000-8000-0000000000c1";
const USER_CLIENT_B = "10000000-0000-4000-8000-0000000000c2";
const USER_CLIENT_C = "10000000-0000-4000-8000-0000000000c3";
const USER_STRANGER = "10000000-0000-4000-8000-0000000000f1";
const COACH_A = "20000000-0000-4000-8000-0000000000a1";
const COACH_B = "20000000-0000-4000-8000-0000000000b1";

const DAY_MS = 86_400_000;

const dayOffset = (days: number, hour = 10): Date => {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + days * DAY_MS + hour * 3_600_000);
};

interface Tables {
  users: Row[];
  coaches: Row[];
  relationships: Row[];
  programs: Row[];
  programDays: Row[];
  programWorkouts: Row[];
  assignments: Row[];
  workouts: Row[];
  workoutStats: Row[];
  workoutExerciseStats: Row[];
  personalRecords: Row[];
  exerciseStats: Row[];
}

let tables: Tables;
let seq = 0;
const newId = (): string => `90000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const userById = (id: string): Row | null => tables.users.find((u) => u.id === id) ?? null;

/** Evaluates a TypeORM find-operator (In / IsNull / MoreThanOrEqual) or a literal. */
const matchValue = (actual: unknown, expected: unknown): boolean => {
  if (expected === null || expected === undefined) return actual == null;
  if (typeof expected === "object" && "_type" in (expected as Row)) {
    const operator = expected as Row;
    switch (operator._type) {
      case "in":
        return (operator._value as unknown[]).map(String).includes(String(actual));
      case "isNull":
        return actual == null;
      case "moreThanOrEqual":
        return actual != null && new Date(actual as string).getTime() >= new Date(operator._value as string).getTime();
      case "or":
        return (operator._value as unknown[]).some((branch) => matchValue(actual, branch));
      default:
        throw new Error(`matchValue: unsupported find operator "${String(operator._type)}"`);
    }
  }
  return actual === expected;
};

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return new Date(a as string).getTime() - new Date(b as string).getTime();
};

/** Generic `find({ where, select, order })` over an in-memory table. */
const makeFind = (table: () => Row[]) =>
  jest.fn(({ where = {}, order = {} }: { where?: Row; order?: Row } = {}) => {
    const rows = table().filter((row) => Object.entries(where).every(([key, expected]) => matchValue(row[key], expected)));
    const orderKeys = Object.entries(order);
    if (orderKeys.length > 0) {
      rows.sort((a, b) => {
        for (const [key, dir] of orderKeys) {
          const cmp = compare(a[key], b[key]);
          if (cmp !== 0) return dir === "DESC" ? -cmp : cmp;
        }
        return 0;
      });
    }
    return Promise.resolve(rows);
  });

const fakeRepo = (table: () => Row[], entityMode = false) => ({
  createQueryBuilder: jest.fn(() => new FakeQueryBuilder(table(), makeResolver(), entityMode)),
  find: makeFind(table),
  findOne: jest.fn()
});

/**
 * JOIN resolver used by the fake. The dashboard's joins are privacy-relevant:
 * `u` is the client behind a relationship, `sourceWorkout` is the live source
 * row behind a progress projection.
 */
const makeResolver =
  () =>
  (alias: string, row: Row): Row | null => {
    // `u` is the client user, joined from a relationship (clientId) or from a
    // progress projection (userId) depending on the query.
    if (alias === "u") return userById((row.clientId ?? row.userId) as string);
    if (alias === "sourceWorkout") {
      const workout = tables.workouts.find((w) => w.id === row.workoutId && w.userId === row.userId);
      return workout ?? null;
    }
    return {};
  };

const relationshipRepo = fakeRepo(() => tables.relationships);
const coachRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(tables.coaches.find((c) => !c.isDeleted && c.userId === where?.userId) ?? null))
};
const userRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(userById(where?.id as string)))
};
const programRepo = fakeRepo(() => tables.programs);
const dayRepo = fakeRepo(() => tables.programDays);
const workoutRepo = fakeRepo(() => tables.programWorkouts);
const assignmentRepo = fakeRepo(() => tables.assignments);
const workoutStatsRepo = fakeRepo(() => tables.workoutStats);
const prRepo = fakeRepo(() => tables.personalRecords);
const exerciseStatsRepo = fakeRepo(() => tables.exerciseStats, true);
const weStatsRepo = fakeRepo(() => tables.workoutExerciseStats);

const progressServiceMock = {
  overview: jest.fn(() => Promise.resolve(emptyOverview())),
  volumeHistory: jest.fn(() => Promise.resolve([])),
  listPersonalRecords: jest.fn(() => Promise.resolve({ data: [], pagination: { page: 1, total: 0, limit: 5, totalPages: 0, hasNextPage: false, hasPrevPage: false } }))
};

const emptyOverview = () => ({
  totalWorkouts: 0,
  totalVolumeKg: 0,
  totalReps: 0,
  totalDurationSeconds: 0,
  avgDurationSeconds: 0,
  activeDays: 0,
  firstWorkoutAt: null,
  lastWorkoutAt: null,
  weeklyWorkoutFrequency: []
});

/* ─────────────────────────────── fixtures ─────────────────────────────── */

interface SeedOptions {
  /** Relationship status for coach A <-> client A. */
  clientAStatus?: RelationshipStatus;
  /** Client A holds this assignment; null means no assignment at all. */
  assignment?: { status: ProgramAssignmentStatus; isActive: boolean; startOffsetDays: number } | null;
  /**
   * Give client A a SECOND live assignment for a different program whose single
   * day lands on offset -3 — the same calendar day as the first plan's day 2,
   * which is the only day with a live logged workout.
   */
  overlappingPlan?: boolean;
}

const seed = (options: SeedOptions = {}): void => {
  // `seq` is intentionally NOT reset: every seed mints fresh relationship ids, so
  // the dashboard's relationship-state cache namespace differs per test and a
  // cached payload can never be served to a later test.
  const { clientAStatus = RelationshipStatus.ACTIVE, assignment = { status: ProgramAssignmentStatus.ACTIVE, isActive: true, startOffsetDays: -4 } } = options;

  tables = {
    users: [
      { id: USER_COACH_A, name: "Coach A", email: "coach-a@test.com", isDeleted: false },
      { id: USER_COACH_B, name: "Coach B", email: "coach-b@test.com", isDeleted: false },
      { id: USER_CLIENT_A, name: "Client A", email: "client-a@test.com", isDeleted: false },
      { id: USER_CLIENT_B, name: "Client B", email: "client-b@test.com", isDeleted: false },
      { id: USER_CLIENT_C, name: "Client C", email: "client-c@test.com", isDeleted: false },
      { id: USER_STRANGER, name: "Stranger", email: "stranger@test.com", isDeleted: false }
    ],
    coaches: [
      { id: COACH_A, name: "Coach A", userId: USER_COACH_A, isDeleted: false, updatedAt: dayOffset(-40) },
      { id: COACH_B, name: "Coach B", userId: USER_COACH_B, isDeleted: false, updatedAt: dayOffset(-40) }
    ],
    relationships: [
      {
        id: newId(),
        coachId: COACH_A,
        clientId: USER_CLIENT_A,
        status: clientAStatus,
        startedAt: dayOffset(-30),
        createdAt: dayOffset(-31),
        updatedAt: dayOffset(-30),
        isDeleted: false
      },
      {
        id: newId(),
        coachId: COACH_B,
        clientId: USER_CLIENT_B,
        status: RelationshipStatus.ACTIVE,
        startedAt: dayOffset(-20),
        createdAt: dayOffset(-21),
        updatedAt: dayOffset(-20),
        isDeleted: false
      },
      {
        id: newId(),
        coachId: COACH_A,
        clientId: USER_CLIENT_C,
        status: RelationshipStatus.PENDING,
        startedAt: null,
        createdAt: dayOffset(-2),
        updatedAt: dayOffset(-2),
        isDeleted: false
      }
    ],
    programs: [{ id: newId(), coachId: COACH_A, name: "Push Plan", isActive: true, isDeleted: false, deletedAt: null }],
    programDays: [
      { id: newId(), programId: "PLACEHOLDER", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Push Day", isDeleted: false, deletedAt: null },
      { id: newId(), programId: "PLACEHOLDER", weekNumber: 1, dayNumber: 2, orderIndex: 1, name: "Pull Day", isDeleted: false, deletedAt: null }
    ],
    programWorkouts: [],
    assignments: [],
    workouts: [],
    workoutStats: [],
    workoutExerciseStats: [],
    personalRecords: [],
    exerciseStats: []
  };

  const programId = tables.programs[0].id as string;
  tables.programDays.forEach((d) => (d.programId = programId));
  tables.programWorkouts.push(
    { id: newId(), programDayId: tables.programDays[0].id, orderIndex: 0, name: "Bench", isDeleted: false, deletedAt: null },
    { id: newId(), programDayId: tables.programDays[0].id, orderIndex: 1, name: "OHP", isDeleted: false, deletedAt: null },
    { id: newId(), programDayId: tables.programDays[1].id, orderIndex: 0, name: "Deadlift", isDeleted: false, deletedAt: null }
  );

  if (assignment) {
    tables.assignments.push({
      id: newId(),
      programId,
      coachId: COACH_A,
      clientId: USER_CLIENT_A,
      startDate: dayOffset(assignment.startOffsetDays),
      endDate: null,
      status: assignment.status,
      isActive: assignment.isActive,
      isDeleted: false,
      deletedAt: null
    });
  }

  if (options.overlappingPlan && assignment) {
    // `uq_program_assignments_live` is partial on (program_id, client_id), so a
    // client may hold two live assignments for two different programs. This one
    // starts a day later, so it outranks the first plan on the dashboard and takes
    // the single logged workout on offset -3, leaving the first plan's Deadlift
    // slot on that same day genuinely missed.
    const overlapProgramId = newId();
    const overlapDayId = newId();
    tables.programs.push({ id: overlapProgramId, coachId: COACH_A, name: "Pull Plan", isActive: true, isDeleted: false, deletedAt: null });
    tables.programDays.push({
      id: overlapDayId,
      programId: overlapProgramId,
      weekNumber: 1,
      dayNumber: 1,
      orderIndex: 0,
      name: "Pull Only Day",
      isDeleted: false,
      deletedAt: null
    });
    tables.programWorkouts.push({ id: newId(), programDayId: overlapDayId, orderIndex: 0, name: "Pull Accessory", isDeleted: false, deletedAt: null });
    tables.assignments.push({
      id: newId(),
      programId: overlapProgramId,
      coachId: COACH_A,
      clientId: USER_CLIENT_A,
      startDate: dayOffset(assignment.startOffsetDays + 1),
      endDate: null,
      status: ProgramAssignmentStatus.ACTIVE,
      isActive: true,
      isDeleted: false,
      deletedAt: null
    });
  }

  // Client A logged two workouts inside the trailing window, deliberately placed
  // on the two program days (start -4 => day 1 at -4, day 2 at -3) so completion
  // arithmetic is exercised. The -4 workout was later soft-deleted, and its
  // projection row is intentionally left behind the way the async projector
  // would, so the dashboard must ignore it.
  addWorkout(USER_CLIENT_A, dayOffset(-3), { volumeKg: 3000, reps: 60, setCount: 8, exerciseCount: 3, name: "Push A" });
  addWorkout(USER_CLIENT_A, dayOffset(-4), { volumeKg: 2000, reps: 40, setCount: 6, exerciseCount: 2, name: "Deleted Push", deleted: true });
  // A live workout outside the trailing window, to prove window scoping.
  addWorkout(USER_CLIENT_A, dayOffset(-60), { volumeKg: 1000, reps: 20, setCount: 4, exerciseCount: 1, name: "Old workout" });

  // Coach B's client: must never surface on coach A's dashboard.
  addWorkout(USER_CLIENT_B, dayOffset(-2), { volumeKg: 9999, reps: 99, setCount: 9, exerciseCount: 4, name: "Coach B secret" });
  // A stranger with no relationship at all.
  addWorkout(USER_STRANGER, dayOffset(-1), { volumeKg: 5555, reps: 55, setCount: 5, exerciseCount: 2, name: "Stranger workout" });
};

interface AddWorkoutOptions {
  volumeKg: number;
  reps: number;
  setCount: number;
  exerciseCount: number;
  name: string;
  deleted?: boolean;
}

const addWorkout = (userId: string, startedAt: Date, options: AddWorkoutOptions): void => {
  const workoutId = newId();
  tables.workouts.push({
    id: workoutId,
    userId,
    name: options.name,
    startedAt,
    isDeleted: options.deleted === true,
    deletedAt: options.deleted === true ? dayOffset(0) : null
  });
  tables.workoutStats.push({
    id: newId(),
    userId,
    workoutId,
    name: options.name,
    startedAt,
    durationSeconds: 3000,
    volumeKg: options.volumeKg,
    reps: options.reps,
    setCount: options.setCount,
    exerciseCount: options.exerciseCount,
    isDeleted: false,
    deletedAt: null
  });
};

const seedProgression = (): void => {
  const stat = tables.workoutStats[0];
  const workout = tables.workouts[0];
  tables.exerciseStats.push({
    id: newId(),
    userId: USER_CLIENT_A,
    exerciseId: "70000000-0000-4000-8000-0000000000e1",
    exerciseName: "Bench Press",
    workoutCount: 2,
    totalVolumeKg: 3000,
    lastPerformedAt: stat.startedAt,
    bestWeightKg: 100,
    bestEstimated1RmKg: 110,
    bestReps: 5,
    isDeleted: false,
    deletedAt: null
  });
  tables.workoutExerciseStats.push(
    {
      id: newId(),
      userId: USER_CLIENT_A,
      workoutId: workout.id,
      exerciseId: "70000000-0000-4000-8000-0000000000e1",
      startedAt: stat.startedAt,
      bestWeightKg: 100,
      bestEstimated1RmKg: 110,
      bestReps: 5,
      volumeKg: 3000,
      isDeleted: false,
      deletedAt: null
    },
    {
      id: newId(),
      userId: USER_CLIENT_A,
      workoutId: workout.id,
      exerciseId: "70000000-0000-4000-8000-0000000000e1",
      startedAt: dayOffset(-10),
      bestWeightKg: 90,
      bestEstimated1RmKg: 99,
      bestReps: 5,
      volumeKg: 2000,
      isDeleted: false,
      deletedAt: null
    }
  );
  tables.personalRecords.push({
    id: newId(),
    userId: USER_CLIENT_A,
    workoutId: workout.id,
    workoutExerciseId: newId(),
    prType: PersonalRecordType.BEST_WEIGHT_KG,
    value: 100,
    exerciseId: "70000000-0000-4000-8000-0000000000e1",
    exerciseName: "Bench Press",
    achievedAt: stat.startedAt,
    isCurrent: true,
    isDeleted: false,
    deletedAt: null
  });
};

/* ──────────────────────────────── harness ─────────────────────────────── */

const guardMock = {
  canActivate: (context: ExecutionContext): boolean => {
    const req = context.switchToHttp().getRequest();
    const userId = (req.headers["x-test-user-id"] as string) ?? USER_STRANGER;
    req.user = userById(userId) ?? { id: userId, name: userId, email: `${userId}@test.com` };
    return true;
  }
};

const http = (app: INestApplication<App>) => request(app.getHttpServer());

const asCoachA = (app: INestApplication<App>) => ({ get: (url: string) => http(app).get(url).set("x-test-user-id", USER_COACH_A) });
const asCoachB = (app: INestApplication<App>) => ({ get: (url: string) => http(app).get(url).set("x-test-user-id", USER_COACH_B) });

describe("Coach dashboard (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CoachDashboardController],
      providers: [
        CoachDashboardService,
        { provide: ProgressService, useValue: progressServiceMock },
        { provide: getRepositoryToken(CoachClientRelationship), useValue: relationshipRepo },
        { provide: getRepositoryToken(Coach), useValue: coachRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Program), useValue: programRepo },
        { provide: getRepositoryToken(ProgramAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(ProgramDay), useValue: dayRepo },
        { provide: getRepositoryToken(ProgramWorkout), useValue: workoutRepo },
        { provide: getRepositoryToken(Workout), useValue: { createQueryBuilder: jest.fn(() => new FakeQueryBuilder(tables.workouts, makeResolver())) } },
        { provide: getRepositoryToken(WorkoutStat), useValue: workoutStatsRepo },
        { provide: getRepositoryToken(WorkoutExerciseStat), useValue: weStatsRepo },
        { provide: getRepositoryToken(PersonalRecord), useValue: prRepo },
        { provide: getRepositoryToken(ExerciseStat), useValue: exerciseStatsRepo }
      ]
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true }
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const mock of [coachRepo.findOne, userRepo.findOne, progressServiceMock.overview, progressServiceMock.volumeHistory, progressServiceMock.listPersonalRecords]) {
      mock.mockClear();
    }
    seed();
  });

  /* ─────────────────────────── privacy / authorization ─────────────────────────── */

  describe("privacy", () => {
    it("returns 404 when coach A requests coach B's client", async () => {
      await asCoachA(app)
        .get("/api/v1/coach-dashboard/clients/" + USER_CLIENT_B)
        .expect(404);
    });

    it("returns 404 for a user who has no relationship with the coach at all", async () => {
      await asCoachA(app)
        .get("/api/v1/coach-dashboard/clients/" + USER_STRANGER)
        .expect(404);
    });

    it("returns 403 for a user without a coach profile", async () => {
      await http(app).get(`/api/v1/coach-dashboard/clients/${USER_CLIENT_A}`).set("x-test-user-id", USER_STRANGER).expect(403);
      await http(app).get("/api/v1/coach-dashboard").set("x-test-user-id", USER_CLIENT_A).expect(403);
      await http(app).get("/api/v1/coach-dashboard/clients").set("x-test-user-id", USER_CLIENT_A).expect(403);
      await http(app).get("/api/v1/coach-dashboard/requests").set("x-test-user-id", USER_CLIENT_A).expect(403);
      await http(app).get("/api/v1/coach-dashboard/activity").set("x-test-user-id", USER_CLIENT_A).expect(403);
      await http(app).get("/api/v1/coach-dashboard/missed-workouts").set("x-test-user-id", USER_CLIENT_A).expect(403);
    });

    it("never leaks another coach's clients, workouts or PRs", async () => {
      const overview = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      const serialized = JSON.stringify(overview.body);
      expect(serialized).not.toContain("Client B");
      expect(serialized).not.toContain("Coach B secret");
      expect(serialized).not.toContain("Stranger workout");

      const activity = await asCoachA(app).get("/api/v1/coach-dashboard/activity").expect(200);
      expect(activity.body.data.every((entry: { clientId: string }) => entry.clientId === USER_CLIENT_A)).toBe(true);

      const missed = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts").expect(200);
      expect(missed.body.data.every((entry: { clientId: string }) => entry.clientId === USER_CLIENT_A)).toBe(true);
    });

    it("keeps each coach's pending requests private", async () => {
      const asA = await asCoachA(app).get("/api/v1/coach-dashboard/requests").expect(200);
      expect(asA.body.data).toHaveLength(1);
      expect(asA.body.data[0].client.id).toBe(USER_CLIENT_C);

      const asB = await asCoachB(app).get("/api/v1/coach-dashboard/requests").expect(200);
      expect(asB.body.data).toEqual([]);
    });

    it("serves each coach their own client set", async () => {
      const asA = await asCoachA(app).get("/api/v1/coach-dashboard/clients").expect(200);
      expect(asA.body.data.map((c: { client: { id: string } }) => c.client.id)).toEqual([USER_CLIENT_A]);

      const asB = await asCoachB(app).get("/api/v1/coach-dashboard/clients").expect(200);
      expect(asB.body.data.map((c: { client: { id: string } }) => c.client.id)).toEqual([USER_CLIENT_B]);
    });
  });

  /* ────────────────────────── relationship lifecycle ────────────────────────── */

  describe("relationship lifecycle", () => {
    it.each([RelationshipStatus.ENDED, RelationshipStatus.BLOCKED])("hides a client whose relationship is %s", async (status) => {
      seed({ clientAStatus: status });

      await asCoachA(app).get(`/api/v1/coach-dashboard/clients/${USER_CLIENT_A}`).expect(404);

      const list = await asCoachA(app).get("/api/v1/coach-dashboard/clients").expect(200);
      expect(list.body.data).toEqual([]);

      const overview = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(overview.body.activeClientCount).toBe(0);
      expect(overview.body.activeClients).toEqual([]);

      const activity = await asCoachA(app).get("/api/v1/coach-dashboard/activity").expect(200);
      expect(activity.body.data).toEqual([]);

      const missed = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts").expect(200);
      expect(missed.body.data).toEqual([]);
    });

    it("keeps a paused client visible but out of the active roster", async () => {
      seed({ clientAStatus: RelationshipStatus.PAUSED });

      await asCoachA(app).get(`/api/v1/coach-dashboard/clients/${USER_CLIENT_A}`).expect(200);

      const list = await asCoachA(app).get("/api/v1/coach-dashboard/clients").expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].relationship.status).toBe(RelationshipStatus.PAUSED);

      const overview = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(overview.body.activeClientCount).toBe(0);
      expect(overview.body.pausedClientCount).toBe(1);
    });

    it("does not expose a client hidden behind a pending (unaccepted) request", async () => {
      seed({ clientAStatus: RelationshipStatus.PENDING });

      await asCoachA(app).get(`/api/v1/coach-dashboard/clients/${USER_CLIENT_A}`).expect(404);

      const overview = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(overview.body.activeClientCount).toBe(0);
      // It surfaces as a request awaiting acceptance instead.
      expect(overview.body.pendingRequestCount).toBe(2);
    });
  });

  /* ────────────────────────────── assignment state ────────────────────────────── */

  describe("program assignment state", () => {
    it("counts an active assignment towards completion, adherence and missed workouts", async () => {
      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      const client = response.body.activeClients[0];

      // Program (starting 4 days ago) has day 1 = 2 slots, day 2 = 1 slot; both
      // days are inside the trailing window => 3 due slots.
      expect(client.programProgress.programName).toBe("Push Plan");
      expect(client.programProgress.totalPlannedWorkouts).toBe(3);
      expect(client.programProgress.scheduledWorkouts).toBe(3);
      // Day 2 was completed by the live workout. Day 1's only workout was
      // soft-deleted, so it must not count — both of its slots are missed.
      expect(client.programProgress.completedWorkouts).toBe(1);
      expect(client.programProgress.missedWorkouts).toBe(2);
      expect(client.programProgress.percentComplete).toBe(33);
      expect(client.workoutAdherence.expectedTrainingDays).toBe(2);
      expect(client.workoutAdherence.completedTrainingDays).toBe(1);
      expect(client.workoutAdherence.adherence).toBe(0.5);
    });

    it("ignores an inactive (terminal) assignment", async () => {
      seed({ assignment: { status: ProgramAssignmentStatus.COMPLETED, isActive: false, startOffsetDays: -30 } });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      const client = response.body.activeClients[0];

      expect(client.programProgress).toBeNull();
      expect(client.missedWorkouts).toBe(0);
      // With no program, adherence falls back to the trailing window basis.
      expect(client.workoutAdherence.expectedTrainingDays).toBe(28);
      expect(client.workoutAdherence.adherence).toBeCloseTo(1 / 28, 5);
    });

    it("reports nothing due for an upcoming assignment that has not started", async () => {
      seed({ assignment: { status: ProgramAssignmentStatus.UPCOMING, isActive: true, startOffsetDays: 10 } });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      const client = response.body.activeClients[0];

      expect(client.programProgress.status).toBe(ProgramAssignmentStatus.UPCOMING);
      expect(client.programProgress.scheduledWorkouts).toBe(0);
      expect(client.programProgress.percentComplete).toBe(0);
      expect(client.missedWorkouts).toBe(0);
      expect(client.workoutAdherence.adherence).toBeNull();
    });

    it("excludes an assignment that ended before the trailing window", async () => {
      seed();
      const assignment = tables.assignments[0];
      assignment.startDate = dayOffset(-60);
      // Older than the 28-day window, so the assignment no longer overlaps it.
      assignment.endDate = dayOffset(-30);

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(response.body.activeClients[0].programProgress).toBeNull();
    });

    it("still counts an assignment that ended inside the window", async () => {
      seed();
      const assignment = tables.assignments[0];
      assignment.startDate = dayOffset(-40);
      assignment.endDate = dayOffset(-10);

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(response.body.activeClients[0].programProgress.programName).toBe("Push Plan");
    });
  });

  /* ─────────────────────── deleted and synced workouts ─────────────────────── */

  describe("workout visibility", () => {
    it("excludes a soft-deleted workout from every metric", async () => {
      const list = await asCoachA(app).get("/api/v1/coach-dashboard/clients").expect(200);
      const client = list.body.data[0];

      // The live in-window workout only: 3000 kg / 1 workout / 1 active day.
      expect(client.workoutCountInWindow).toBe(1);
      expect(client.lastWorkoutAt).toBe(dayOffset(-3).toISOString());

      const activity = await asCoachA(app).get("/api/v1/coach-dashboard/activity").expect(200);
      expect(activity.body.data.map((e: { name: string }) => e.name).sort()).toEqual(["Old workout", "Push A"]);
      expect(JSON.stringify(activity.body)).not.toContain("Deleted Push");
    });

    it("includes a freshly synced workout in the feed", async () => {
      const syncedId = newId();
      tables.workouts.push({ id: syncedId, userId: USER_CLIENT_A, name: "Synced from phone", startedAt: dayOffset(-1, 20), isDeleted: false, deletedAt: null });
      tables.workoutStats.push({
        id: newId(),
        userId: USER_CLIENT_A,
        workoutId: syncedId,
        name: "Synced from phone",
        startedAt: dayOffset(-1, 20),
        durationSeconds: 1800,
        volumeKg: 1500,
        reps: 30,
        setCount: 5,
        exerciseCount: 2,
        isDeleted: false,
        deletedAt: null
      });

      const activity = await asCoachA(app).get("/api/v1/coach-dashboard/activity").expect(200);
      expect(activity.body.data[0].workoutId).toBe(syncedId);
      expect(activity.body.data[0].name).toBe("Synced from phone");
      expect(activity.body.data[0].volumeKg).toBe(1500);
    });

    it("hides a projection whose source workout was deleted after projection", async () => {
      const activity = await asCoachA(app).get("/api/v1/coach-dashboard/activity?windowDays=1").expect(200);
      expect(JSON.stringify(activity.body)).not.toContain("Deleted Push");
    });
  });

  /* ────────────────────────── missed workouts feed ────────────────────────── */

  describe("missed workouts", () => {
    it("lists missed slots oldest first with program context", async () => {
      const response = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?limit=50").expect(200);

      // Day 1 (the older program day) has 2 unlogged slots; day 2 was completed.
      expect(response.body.pagination.total).toBe(2);
      const scheduled = response.body.data.map((e: { scheduledDate: string }) => new Date(e.scheduledDate).getTime());
      expect(scheduled).toEqual([...scheduled].sort((a, b) => a - b));

      const first = response.body.data[0];
      expect(first).toEqual(
        expect.objectContaining({
          clientId: USER_CLIENT_A,
          clientName: "Client A",
          programName: "Push Plan",
          programId: tables.programs[0].id,
          dayName: "Push Day",
          workoutName: "Bench"
        })
      );
      expect(first.daysOverdue).toBe(4);
      expect(response.body.data[0].assignmentId).toBe(tables.assignments[0].id);
    });

    it("credits a shared workout once when two live plans fall on the same day", async () => {
      seed({ overlappingPlan: true });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?limit=50").expect(200);

      // Offset -3 is the only day with a live logged workout, and it now carries
      // two scheduled slots (Push Plan "Deadlift" and Pull Plan "Pull Accessory").
      // One workout satisfies one slot, so exactly one of them is missed. Crediting
      // each plan independently would have claimed the same workout twice and
      // reported the client as fully compliant.
      const onDay3 = response.body.data.filter((e: { scheduledDate: string }) => new Date(e.scheduledDate).toISOString().slice(0, 10) === dayOffset(-3).toISOString().slice(0, 10));
      expect(onDay3).toHaveLength(1);
      // The later-starting Pull Plan outranks Push Plan, so it keeps the credit and
      // the shortage is attributed to Push Plan's Deadlift slot.
      expect(onDay3[0]).toEqual(
        expect.objectContaining({
          clientId: USER_CLIENT_A,
          programName: "Push Plan",
          dayName: "Pull Day",
          workoutName: "Deadlift"
        })
      );
      // Offset -4 still contributes its two unlogged slots.
      expect(response.body.pagination.total).toBe(3);
    });

    it("reports merged compliance across two live plans sharing a day", async () => {
      seed({ overlappingPlan: true });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard?windowDays=28").expect(200);

      // Push Plan schedules 2 slots on -4 and 1 on -3; Pull Plan schedules 1 on -3.
      expect(response.body.programProgress).toEqual(
        expect.objectContaining({
          activeAssignments: 2,
          scheduledWorkouts: 4,
          // The -4 workout is soft-deleted and the single live workout on -3 can
          // only satisfy one of the two slots due that day.
          completedWorkouts: 1,
          missedWorkouts: 3,
          percentComplete: 25
        })
      );
      // Three scheduled training days: Push Plan on -4 and -3, plus Pull Plan on
      // -3. Only the -3 workout exists, and it can cover one of the two days that
      // scheduled training, so adherence is 1/3 rather than a misleading 1/2.
      expect(response.body.workoutAdherence).toEqual(expect.objectContaining({ completedTrainingDays: 1, expectedTrainingDays: 3, adherence: 1 / 3 }));
    });

    it("paginates the missed queue without losing the total", async () => {
      const first = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?page=1&limit=1").expect(200);
      const second = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?page=2&limit=1").expect(200);

      expect(first.body.data).toHaveLength(1);
      expect(second.body.data).toHaveLength(1);
      expect(first.body.pagination).toEqual({ total: 2, page: 1, limit: 1, totalPages: 2, hasNextPage: true, hasPrevPage: false });
      expect(second.body.pagination).toEqual({ total: 2, page: 2, limit: 1, totalPages: 2, hasNextPage: false, hasPrevPage: true });
      expect(first.body.data[0].workoutId).not.toBe(second.body.data[0].workoutId);
    });

    it("returns an empty queue when the assignment is not active", async () => {
      seed({ assignment: { status: ProgramAssignmentStatus.CANCELLED, isActive: false, startOffsetDays: -30 } });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts").expect(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });
  });

  /* ────────────────────── summaries, detail, trends, PRs ────────────────────── */

  describe("dashboard payloads", () => {
    it("builds a client progress summary with no raw entity leakage", async () => {
      const response = await asCoachA(app).get("/api/v1/coach-dashboard/clients").expect(200);
      const client = response.body.data[0];

      expect(Object.keys(client).sort()).toEqual(
        ["client", "lastWorkoutAt", "missedWorkouts", "programProgress", "recentPrCount", "relationship", "totalWorkoutCount", "workoutAdherence", "workoutCountInWindow"].sort()
      );
      expect(client.client).toEqual({ id: USER_CLIENT_A, name: "Client A", email: "client-a@test.com" });
      expect(client).not.toHaveProperty("userId");
      expect(client.relationship).not.toHaveProperty("coachId");
      expect(client.programProgress).not.toHaveProperty("client");
    });

    it("paginates the client list and reports honest totals", async () => {
      const page1 = await asCoachA(app).get("/api/v1/coach-dashboard/clients?page=1&limit=1").expect(200);
      const page2 = await asCoachA(app).get("/api/v1/coach-dashboard/clients?page=2&limit=1").expect(200);

      expect(page1.body.data).toHaveLength(1);
      expect(page2.body.data).toEqual([]);
      expect(page1.body.pagination).toEqual({ total: 1, page: 1, limit: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false });
    });

    it("assembles client detail with progression, PRs, trends and missed detail", async () => {
      seedProgression();
      const response = await asCoachA(app).get(`/api/v1/coach-dashboard/clients/${USER_CLIENT_A}?recentLimit=2`).expect(200);

      expect(response.body.client.id).toBe(USER_CLIENT_A);
      expect(response.body.recentWorkouts.map((w: { name: string }) => w.name)).toEqual(["Push A", "Old workout"]);
      expect(response.body.exerciseProgression[0].exerciseName).toBe("Bench Press");
      expect(response.body.exerciseProgression[0].recentSessions).toHaveLength(2);
      expect(response.body.missedWorkoutDetails).toHaveLength(2);
      expect(response.body.missedWorkoutDetails[0].programName).toBe("Push Plan");
      expect(response.body.relationship.id).toBe(tables.relationships[0].id);
    });

    it("returns recent PRs scoped to the coach's own clients", async () => {
      seedProgression();
      tables.personalRecords.push({
        id: newId(),
        userId: USER_CLIENT_B,
        workoutId: tables.workouts.find((w) => w.userId === USER_CLIENT_B)!.id,
        workoutExerciseId: newId(),
        prType: PersonalRecordType.BEST_WEIGHT_KG,
        value: 300,
        exerciseId: null,
        exerciseName: "Coach B lift",
        achievedAt: dayOffset(-1),
        isCurrent: true,
        isDeleted: false,
        deletedAt: null
      });

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(response.body.recentPersonalRecords).toHaveLength(1);
      expect(response.body.recentPersonalRecords[0]).toEqual(expect.objectContaining({ clientId: USER_CLIENT_A, exerciseName: "Bench Press", value: 100 }));
    });

    it("aggregates progress trends over the requested weeks", async () => {
      const countWorkouts = (body: { progressTrends: { workoutCount: number; volumeKg: number }[] }): number =>
        body.progressTrends.reduce((acc, trend) => acc + trend.workoutCount, 0);

      // A 4-week window only reaches back to the live -3 workout: the -4 workout
      // is soft-deleted and the -60 workout predates the window.
      const narrow = await asCoachA(app).get("/api/v1/coach-dashboard?weeks=4").expect(200);
      expect(countWorkouts(narrow.body)).toBe(1);
      expect(narrow.body.progressTrends).toHaveLength(1);
      expect(narrow.body.progressTrends[0].volumeKg).toBe(3000);

      // Widening the window pulls the old live workout into its own week bucket.
      // The total is 2, never 3: the deleted workout is never counted.
      const wide = await asCoachA(app).get("/api/v1/coach-dashboard?weeks=12").expect(200);
      expect(countWorkouts(wide.body)).toBe(2);
      expect(wide.body.progressTrends).toHaveLength(2);
      // One bucket per ISO week, oldest first — not every row collapsed into a
      // single bucket by an unresolvable GROUP BY key.
      const buckets = wide.body.progressTrends.map((t: { bucket: string }) => new Date(t.bucket).getTime());
      expect(buckets).toEqual([...buckets].sort((a: number, b: number) => a - b));
      expect(wide.body.progressTrends.every((t: { volumeKg: number }) => typeof t.volumeKg === "number")).toBe(true);
    });

    it("reports counts and program rollups on the overview", async () => {
      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);

      expect(response.body.activeClientCount).toBe(1);
      expect(response.body.pausedClientCount).toBe(0);
      expect(response.body.pendingRequestCount).toBe(1);
      expect(response.body.programProgress).toEqual({
        activeAssignments: 1,
        scheduledWorkouts: 3,
        completedWorkouts: 1,
        missedWorkouts: 2,
        percentComplete: 33
      });
      expect(response.body.workoutAdherence).toEqual({
        completedTrainingDays: 1,
        expectedTrainingDays: 2,
        adherence: 0.5,
        windowDays: 28
      });
    });

    it("returns a well-formed empty dashboard for a coach with no clients", async () => {
      tables.relationships = tables.relationships.filter((r) => r.coachId === COACH_B);

      const response = await asCoachA(app).get("/api/v1/coach-dashboard").expect(200);
      expect(response.body).toEqual({
        activeClientCount: 0,
        pausedClientCount: 0,
        pendingRequestCount: 0,
        activeClients: [],
        pendingRequests: [],
        recentClientWorkouts: [],
        workoutAdherence: null,
        programProgress: { activeAssignments: 0, scheduledWorkouts: 0, completedWorkouts: 0, missedWorkouts: 0, percentComplete: 0 },
        recentPersonalRecords: [],
        progressTrends: []
      });
    });
  });

  /* ────────────────────────────── query discipline ────────────────────────────── */

  describe("query discipline", () => {
    it("uses a fixed number of queries regardless of client count", async () => {
      const countCalls = (): number => workoutStatsRepo.createQueryBuilder.mock.calls.length;

      const before = countCalls();
      await asCoachA(app).get("/api/v1/coach-dashboard?weeks=4").expect(200);
      const single = countCalls() - before;

      // Give coach A a second and third client, then re-measure.
      seed();
      tables.relationships.push(
        {
          id: newId(),
          coachId: COACH_A,
          clientId: USER_CLIENT_B,
          status: RelationshipStatus.ACTIVE,
          startedAt: dayOffset(-10),
          createdAt: dayOffset(-11),
          updatedAt: dayOffset(-10),
          isDeleted: false
        },
        {
          id: newId(),
          coachId: COACH_A,
          clientId: USER_STRANGER,
          status: RelationshipStatus.ACTIVE,
          startedAt: dayOffset(-5),
          createdAt: dayOffset(-6),
          updatedAt: dayOffset(-5),
          isDeleted: false
        }
      );

      const after = countCalls();
      await asCoachA(app).get("/api/v1/coach-dashboard?weeks=4").expect(200);
      const triple = countCalls() - after;

      expect(triple).toBe(single);
      // Sanity bound: the overview must stay a small, fixed query set.
      expect(single).toBeLessThanOrEqual(8);
    });

    it("keeps the missed-workout queue at a flat query count as clients grow", async () => {
      const countCalls = (): number => workoutStatsRepo.createQueryBuilder.mock.calls.length;

      const before = countCalls();
      const single = (await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?limit=50").expect(200)).body;
      const singleCalls = countCalls() - before;

      seed();
      for (const clientId of [USER_CLIENT_B, USER_STRANGER]) {
        tables.relationships.push({
          id: newId(),
          coachId: COACH_A,
          clientId,
          status: RelationshipStatus.ACTIVE,
          startedAt: dayOffset(-10),
          createdAt: dayOffset(-11),
          updatedAt: dayOffset(-10),
          isDeleted: false
        });
      }

      const after = countCalls();
      const triple = (await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?limit=50").expect(200)).body;
      const tripleCalls = countCalls() - after;

      // Per-client program schedules would show up here as growth with client
      // count. Instead every client's window is served by the same projections
      // query plus a fixed set of IN-loaded program lookups.
      expect(tripleCalls).toBe(singleCalls);
      expect(singleCalls).toBeLessThanOrEqual(2);
      // The three added clients have no assignment, so the queue is unchanged.
      expect(triple.pagination.total).toBe(single.pagination.total);
    });

    it("rejects out-of-range pagination and window parameters", async () => {
      await asCoachA(app).get("/api/v1/coach-dashboard/clients?page=0").expect(400);
      await asCoachA(app).get("/api/v1/coach-dashboard/clients?limit=101").expect(400);
      await asCoachA(app).get("/api/v1/coach-dashboard?windowDays=91").expect(400);
      await asCoachA(app).get("/api/v1/coach-dashboard?weeks=53").expect(400);
      await asCoachA(app).get("/api/v1/coach-dashboard/missed-workouts?windowDays=91").expect(400);
    });
  });
});
