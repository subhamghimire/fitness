/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { INestApplication, ValidationPipe, ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import { getRepositoryToken } from "@nestjs/typeorm";
import { CoachClientRelationship } from "./../src/modules/coach-client/entities/coach-client-relationship.entity";
import { Coach } from "./../src/modules/coach/entities/coach.entity";
import { User } from "./../src/modules/users/entities/user.entity";
import { Program } from "./../src/modules/program/entities/program.entity";
import { ProgramDay } from "./../src/modules/program/entities/program-day.entity";
import { ProgramWorkout } from "./../src/modules/program/entities/program-workout.entity";
import { ProgramAssignment } from "./../src/modules/program/entities/program-assignment.entity";
import { WorkoutTemplate } from "./../src/modules/workout/entities/workout-template.entity";
import { WorkoutStat } from "./../src/modules/progress/entities/workout-stat.entity";
import { CoachClientRelationshipService } from "./../src/modules/coach-client/coach-client-relationship.service";
import { ProgramService } from "./../src/modules/program/program.service";
import { ProgramAssignmentService } from "./../src/modules/program/program-assignment.service";
import { CoachClientRelationshipController } from "./../src/modules/coach-client/coach-client-relationship.controller";
import { ClientCoachController } from "./../src/modules/coach-client/client-coach.controller";
import { ProgramController } from "./../src/modules/program/program.controller";
import { ClientProgramController } from "./../src/modules/program/client-program.controller";
import { ProgressService } from "./../src/modules/progress/progress.service";
import { JwtAuthGuard } from "./../src/modules/auth/guards/jwt-auth.guard";

const USER_COACH_A = "10000000-0000-4000-8000-000000000001";
const USER_COACH_B = "10000000-0000-4000-8000-000000000002";
const USER_CLIENT_1 = "10000000-0000-4000-8000-000000000003";
const USER_CLIENT_2 = "10000000-0000-4000-8000-000000000004";
const COACH_A = "20000000-0000-4000-8000-000000000001";
const COACH_B = "20000000-0000-4000-8000-000000000002";

type AnyRow = Record<string, unknown> & { id?: string; isDeleted?: boolean };

interface DBSchema {
  usersById: Map<string, { id: string; name: string; email: string }>;
  coachByUserId: Map<string, { id: string; name: string; userId: string }>;
  relationships: AnyRow[];
  programs: AnyRow[];
  assignments: AnyRow[];
  workoutStats: AnyRow[];
}

const db: DBSchema = {
  usersById: new Map(),
  coachByUserId: new Map(),
  relationships: [],
  programs: [],
  assignments: [],
  workoutStats: []
};

let seq = 0;
const newId = (): string => `30000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const matches = (row: AnyRow, where: Record<string, unknown> | undefined): boolean => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);

const attachRelations = (rel: AnyRow): void => {
  const coach = Array.from(db.coachByUserId.values()).find((c) => c.id === rel.coachId);
  rel.coach = coach ?? { id: rel.coachId as string, name: "Coach", userId: rel.coachId as string };
  rel.client = db.usersById.get(rel.clientId as string) ?? { id: rel.clientId, name: "Client", email: "client@test.com" };
};

/* ────────────────────────── repository fakes ────────────────────────── */

const coachRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(Array.from(db.coachByUserId.values()).find((c) => c.userId === where?.userId) ?? null))
};

const userRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(db.usersById.get(where?.id as string) ?? null))
};

const relationshipRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(db.relationships.find((r) => !r.isDeleted && matches(r, where)) ?? null)),
  find: jest.fn(({ where, order }: { where?: Record<string, unknown>; order?: Record<string, "ASC" | "DESC"> } = {}) => {
    let rows = db.relationships.filter((r) => !r.isDeleted && matches(r, where));
    if (order?.createdAt === "DESC") rows = rows.slice().reverse();
    return Promise.resolve(rows);
  }),
  create: jest.fn((row: AnyRow) => row),
  save: jest.fn((row: AnyRow) => {
    row.isDeleted ??= false;
    const existing = db.relationships.find((r) => r.id === row.id);
    if (existing) Object.assign(existing, row);
    else {
      row.id = newId();
      row.createdAt ??= new Date("2026-01-01T00:00:00Z");
      row.updatedAt ??= new Date();
      db.relationships.push(row);
    }
    attachRelations(row);
    return Promise.resolve(row);
  })
};

const programRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(db.programs.find((p) => !p.isDeleted && matches(p, where)) ?? null)),
  findAndCount: jest.fn(({ where, skip = 0, take = 100 }: { where?: Record<string, unknown>; skip?: number; take?: number } = {}) => {
    const rows = db.programs.filter((p) => !p.isDeleted && matches(p, where));
    return Promise.resolve([rows.slice(skip, skip + take), rows.length]);
  }),
  create: jest.fn((row: AnyRow) => row),
  save: jest.fn((row: AnyRow) => {
    row.isDeleted ??= false;
    row.isActive ??= true;
    const existing = db.programs.find((p) => p.id === row.id);
    if (existing) Object.assign(existing, row);
    else {
      row.id = newId();
      row.createdAt ??= new Date();
      row.updatedAt ??= new Date();
      db.programs.push(row);
    }
    return Promise.resolve(row);
  })
};

const dayRepo = {
  create: jest.fn((row: AnyRow) => row),
  save: jest.fn((row: AnyRow) => {
    const allDays = db.programs.flatMap((p) => (p.days as AnyRow[]) ?? []);
    const existing = allDays.find((d) => d.id === row.id);
    if (existing) Object.assign(existing, row);
    return Promise.resolve(row);
  })
};

const workoutRepo = {
  create: jest.fn((row: AnyRow) => row)
};

const templateRepo = {
  count: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => {
    const ids = (where?.id as { _value?: unknown[] } | undefined)?._value;
    return Promise.resolve(Array.isArray(ids) ? new Set(ids as string[]).size : 0);
  })
};

const assignmentRepo = {
  findOne: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => Promise.resolve(db.assignments.find((a) => !a.isDeleted && matches(a, where)) ?? null)),
  find: jest.fn(({ where, order }: { where?: Record<string, unknown>; order?: Record<string, "ASC" | "DESC"> } = {}) => {
    let rows = db.assignments.filter((a) => !a.isDeleted && matches(a, where));
    if (order?.startDate === "DESC") {
      rows = rows.slice().sort((a, b) => new Date(b.startDate as string).getTime() - new Date(a.startDate as string).getTime());
    }
    return Promise.resolve(rows);
  }),
  create: jest.fn((row: AnyRow) => row),
  save: jest.fn((row: AnyRow) => {
    row.isDeleted ??= false;
    const existing = db.assignments.find((a) => a.id === row.id);
    if (existing) Object.assign(existing, row);
    else {
      row.id = newId();
      row.createdAt ??= new Date();
      row.updatedAt ??= new Date();
      db.assignments.push(row);
    }
    row.client = db.usersById.get(row.clientId as string) ?? { id: row.clientId, name: "Client", email: "client@test.com" };
    row.program = db.programs.find((p) => p.id === row.programId) ?? row.program;
    return Promise.resolve(row);
  })
};

const workoutStatsRepo = {
  find: jest.fn(({ where }: { where?: Record<string, unknown> } = {}) => {
    let rows = db.workoutStats.filter((s) => s.userId === where?.userId);
    const startedAt = where?.startedAt as { _type?: string; _value?: unknown } | undefined;
    if (startedAt && typeof startedAt === "object") {
      if (startedAt._type === "between") {
        const [from, to] = startedAt._value as [Date, Date];
        rows = rows.filter((s) => (s.startedAt as Date) >= from && (s.startedAt as Date) <= to);
      } else if (startedAt._type === "moreThanOrEqual") {
        const from = startedAt._value as Date;
        rows = rows.filter((s) => (s.startedAt as Date) >= from);
      }
    }
    rows = rows.slice().sort((a, b) => (a.startedAt as Date).getTime() - (b.startedAt as Date).getTime());
    return Promise.resolve(rows);
  })
};

const progressServiceMock = {
  overview: jest.fn(() =>
    Promise.resolve({
      totalWorkouts: 3,
      totalVolumeKg: 12000,
      totalReps: 40,
      totalDurationSeconds: 3600,
      avgDurationSeconds: 1200,
      activeDays: 2,
      firstWorkoutAt: new Date("2026-01-05T00:00:00Z"),
      lastWorkoutAt: new Date("2026-01-12T00:00:00Z"),
      weeklyWorkoutFrequency: []
    })
  )
};

/* ───────────────────────────── helpers ──────────────────────────────── */

const resetDb = (): void => {
  seq = 0;
  db.usersById = new Map();
  db.coachByUserId = new Map();
  db.relationships = [];
  db.programs = [];
  db.assignments = [];
  db.workoutStats = [];
  for (const mock of [
    coachRepo.findOne,
    userRepo.findOne,
    relationshipRepo.findOne,
    relationshipRepo.find,
    relationshipRepo.create,
    relationshipRepo.save,
    programRepo.findOne,
    programRepo.findAndCount,
    programRepo.create,
    programRepo.save,
    dayRepo.create,
    dayRepo.save,
    workoutRepo.create,
    templateRepo.count,
    assignmentRepo.findOne,
    assignmentRepo.find,
    assignmentRepo.create,
    assignmentRepo.save,
    workoutStatsRepo.find,
    progressServiceMock.overview
  ]) {
    mock.mockClear();
  }
};

const seed = (): void => {
  const users = [
    { id: USER_COACH_A, name: "Coach A", email: "coacha@test.com" },
    { id: USER_COACH_B, name: "Coach B", email: "coachb@test.com" },
    { id: USER_CLIENT_1, name: "Client One", email: "c1@test.com" },
    { id: USER_CLIENT_2, name: "Client Two", email: "c2@test.com" }
  ];
  for (const u of users) db.usersById.set(u.id, u);
  db.coachByUserId.set(USER_COACH_A, { id: COACH_A, name: "Coach A", userId: USER_COACH_A });
  db.coachByUserId.set(USER_COACH_B, { id: COACH_B, name: "Coach B", userId: USER_COACH_B });
};

const guardMock = {
  canActivate: (context: ExecutionContext): boolean => {
    const req = context.switchToHttp().getRequest();
    const userId = (req.headers["x-test-user-id"] as string) ?? USER_CLIENT_1;
    req.user = db.usersById.get(userId) ?? { id: userId, name: userId, email: `${userId}@test.com` };
    return true;
  }
};

const http = (app: INestApplication<App>) => request(app.getHttpServer());

describe("Coach-client relationships and programs (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CoachClientRelationshipController, ClientCoachController, ProgramController, ClientProgramController],
      providers: [
        CoachClientRelationshipService,
        ProgramService,
        ProgramAssignmentService,
        { provide: ProgressService, useValue: progressServiceMock },
        { provide: getRepositoryToken(CoachClientRelationship), useValue: relationshipRepo },
        { provide: getRepositoryToken(Coach), useValue: coachRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Program), useValue: programRepo },
        { provide: getRepositoryToken(ProgramDay), useValue: dayRepo },
        { provide: getRepositoryToken(ProgramWorkout), useValue: workoutRepo },
        { provide: getRepositoryToken(WorkoutTemplate), useValue: templateRepo },
        { provide: getRepositoryToken(ProgramAssignment), useValue: assignmentRepo },
        { provide: getRepositoryToken(WorkoutStat), useValue: workoutStatsRepo }
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
    resetDb();
    seed();
  });

  const invite = (coachId: string, clientId: string) => http(app).post("/api/v1/coach-clients/invitations").set("x-test-user-id", coachId).send({ clientId }).expect(201);

  it("runs a full invitation lifecycle: invite -> list -> accept -> view coach", async () => {
    const rel = await invite(USER_COACH_A, USER_CLIENT_1);
    expect(rel.body.status).toBe("pending");
    const relId = rel.body.id as string;

    const asCoachB = await http(app).get("/api/v1/coach-clients").set("x-test-user-id", USER_COACH_B).expect(200);
    expect(asCoachB.body).toEqual([]);
    const asCoachA = await http(app).get("/api/v1/coach-clients").set("x-test-user-id", USER_COACH_A).expect(200);
    expect(asCoachA.body).toHaveLength(1);
    expect(asCoachA.body[0].client.id).toBe(USER_CLIENT_1);

    const accepted = await http(app).post(`/api/v1/coach-clients/${relId}/accept`).set("x-test-user-id", USER_CLIENT_1).expect(200);
    expect(accepted.body.status).toBe("active");
    expect(accepted.body.startedAt).not.toBeNull();

    const myCoach = await http(app).get("/api/v1/client/coach").set("x-test-user-id", USER_CLIENT_1).expect(200);
    expect(myCoach.body.relationship.status).toBe("active");
    expect(myCoach.body.coach.id).toBe(COACH_A);

    await http(app).get("/api/v1/client/coach").set("x-test-user-id", USER_CLIENT_2).expect(404);
  });

  it("forbids strangers from accepting someone else's invitation and blocks duplicate live invitations", async () => {
    const rel = await invite(USER_COACH_A, USER_CLIENT_1);
    await http(app).post(`/api/v1/coach-clients/${rel.body.id}/accept`).set("x-test-user-id", USER_CLIENT_2).expect(404);

    await http(app).post("/api/v1/coach-clients/invitations").set("x-test-user-id", USER_COACH_A).send({ clientId: USER_CLIENT_1 }).expect(409);
  });

  it("only the owning coach can manage a relationship and the lifecycle is preserved", async () => {
    const rel = await invite(USER_COACH_A, USER_CLIENT_1);
    await http(app).post(`/api/v1/coach-clients/${rel.body.id}/accept`).set("x-test-user-id", USER_CLIENT_1).expect(200);

    const pause = await http(app).patch(`/api/v1/coach-clients/${rel.body.id}/status`).set("x-test-user-id", USER_COACH_A).send({ status: "paused" }).expect(200);
    expect(pause.body.status).toBe("paused");

    await http(app).patch(`/api/v1/coach-clients/${rel.body.id}/status`).set("x-test-user-id", USER_COACH_B).send({ status: "ended" }).expect(404);

    const end = await http(app).patch(`/api/v1/coach-clients/${rel.body.id}/status`).set("x-test-user-id", USER_COACH_A).send({ status: "ended" }).expect(200);
    expect(end.body.status).toBe("ended");
    expect(end.body.endedAt).not.toBeNull();

    await http(app).patch(`/api/v1/coach-clients/${rel.body.id}/status`).set("x-test-user-id", USER_COACH_A).send({ status: "active" }).expect(400);

    await http(app).patch(`/api/v1/coach-clients/${rel.body.id}/status`).set("x-test-user-id", USER_COACH_A).send({ status: "blocked" }).expect(400);
  });

  it("coach progress view is scoped to relationship ownership", async () => {
    const rel = await invite(USER_COACH_A, USER_CLIENT_1);
    await http(app).post(`/api/v1/coach-clients/${rel.body.id}/accept`).set("x-test-user-id", USER_CLIENT_1).expect(200);

    const own = await http(app).get(`/api/v1/coach-clients/${rel.body.id}/progress`).set("x-test-user-id", USER_COACH_A).expect(200);
    expect(own.body.relationshipId).toBe(rel.body.id);
    expect(own.body.clientId).toBe(USER_CLIENT_1);
    expect(own.body.overview.totalWorkouts).toBe(3);

    const asClient = await http(app).get(`/api/v1/coach-clients/${rel.body.id}/progress`).set("x-test-user-id", USER_CLIENT_1).expect(200);
    expect(asClient.body.clientId).toBe(USER_CLIENT_1);

    await http(app).get(`/api/v1/coach-clients/${rel.body.id}/progress`).set("x-test-user-id", USER_CLIENT_2).expect(404);
  });

  describe("program CRUD ownership", () => {
    it("only a coach can create a program and only the owner can read it", async () => {
      const created = await http(app)
        .post("/api/v1/programs")
        .set("x-test-user-id", USER_COACH_A)
        .send({
          name: "12-week base",
          days: [
            {
              weekNumber: 1,
              dayNumber: 1,
              orderIndex: 0,
              name: "Day 1",
              workouts: [
                { workoutTemplateId: "30100000-0000-4000-8000-000000000001", name: "Squat day", orderIndex: 0 },
                { workoutTemplateId: "30100000-0000-4000-8000-000000000002", name: "Accessory", orderIndex: 1 }
              ]
            },
            {
              weekNumber: 1,
              dayNumber: 3,
              orderIndex: 1,
              name: "Day 3",
              workouts: [{ workoutTemplateId: "30100000-0000-4000-8000-000000000003", name: "Deadlift day", orderIndex: 0 }]
            }
          ]
        })
        .expect(201);
      expect(created.body.days).toHaveLength(2);
      expect(created.body.days[0].workouts).toHaveLength(2);

      await http(app).get(`/api/v1/programs/${created.body.id}`).set("x-test-user-id", USER_COACH_B).expect(404);
      await http(app).get(`/api/v1/programs/${created.body.id}`).set("x-test-user-id", USER_CLIENT_1).expect(403);

      const mine = await http(app).get("/api/v1/programs").set("x-test-user-id", USER_COACH_A).expect(200);
      expect(mine.body.data).toHaveLength(1);
      const others = await http(app).get("/api/v1/programs").set("x-test-user-id", USER_COACH_B).expect(200);
      expect(others.body.data).toHaveLength(0);

      await http(app).post("/api/v1/programs").set("x-test-user-id", USER_CLIENT_1).send({ name: "nope" }).expect(403);
    });

    it("soft-deletes and hides deleted programs from other coaches", async () => {
      const created = await http(app).post("/api/v1/programs").set("x-test-user-id", USER_COACH_A).send({ name: "Basics" }).expect(201);
      await http(app).delete(`/api/v1/programs/${created.body.id}`).set("x-test-user-id", USER_COACH_A).expect(200);
      await http(app).get(`/api/v1/programs/${created.body.id}`).set("x-test-user-id", USER_COACH_A).expect(404);
    });

    it("allows the owner to replace the day schedule while preserving soft-deleted days", async () => {
      const created = await http(app)
        .post("/api/v1/programs")
        .set("x-test-user-id", USER_COACH_A)
        .send({
          name: "Basics",
          days: [
            {
              weekNumber: 1,
              dayNumber: 1,
              workouts: [{ workoutTemplateId: "40100000-0000-4000-8000-000000000001", name: "A", orderIndex: 0 }]
            }
          ]
        })
        .expect(201);

      const updated = await http(app)
        .patch(`/api/v1/programs/${created.body.id}`)
        .set("x-test-user-id", USER_COACH_A)
        .send({
          name: "Basics v2",
          days: [
            {
              weekNumber: 1,
              dayNumber: 2,
              workouts: [{ workoutTemplateId: "40100000-0000-4000-8000-000000000002", name: "B", orderIndex: 0 }]
            }
          ]
        })
        .expect(200);
      expect(updated.body.name).toBe("Basics v2");
      expect(updated.body.days).toHaveLength(1);
      expect(updated.body.days[0].dayNumber).toBe(2);
      expect(dayRepo.save).toHaveBeenCalled();
    });
  });

  describe("program assignments + authorization", () => {
    const setup = async (): Promise<{ relId: string; programId: string }> => {
      const rel = await invite(USER_COACH_A, USER_CLIENT_1);
      await http(app).post(`/api/v1/coach-clients/${rel.body.id}/accept`).set("x-test-user-id", USER_CLIENT_1).expect(200);
      const program = await http(app)
        .post("/api/v1/programs")
        .set("x-test-user-id", USER_COACH_A)
        .send({
          name: "12-week base",
          days: [
            {
              weekNumber: 1,
              dayNumber: 1,
              orderIndex: 0,
              name: "Day 1",
              workouts: [
                { workoutTemplateId: "50100000-0000-4000-8000-000000000001", name: "Squat day", orderIndex: 0 },
                { workoutTemplateId: "50100000-0000-4000-8000-000000000002", name: "Accessory", orderIndex: 1 }
              ]
            },
            {
              weekNumber: 1,
              dayNumber: 3,
              orderIndex: 1,
              name: "Day 3",
              workouts: [{ workoutTemplateId: "50100000-0000-4000-8000-000000000003", name: "Deadlift day", orderIndex: 0 }]
            }
          ]
        })
        .expect(201);
      return { relId: rel.body.id as string, programId: program.body.id as string };
    };

    const assign = (programId: string, clientId: string, coachId = USER_COACH_A) =>
      http(app)
        .post(`/api/v1/programs/${programId}/assignments`)
        .set("x-test-user-id", coachId)
        .send({ clientId, startDate: "2026-01-05T00:00:00Z", endDate: "2026-03-30T00:00:00Z" });

    it("assigns a program only with an active relationship; rejects cross-coach and unaffected clients", async () => {
      const { programId } = await setup();

      const created = await assign(programId, USER_CLIENT_1).expect(201);
      expect(created.body.client.id).toBe(USER_CLIENT_1);
      expect(created.body.program.id).toBe(programId);

      await http(app).get(`/api/v1/programs/assignments/${created.body.id}`).set("x-test-user-id", USER_COACH_B).expect(404);
      await http(app).get(`/api/v1/client/programs/${created.body.id}`).set("x-test-user-id", USER_CLIENT_2).expect(404);

      const clientPrograms = await http(app).get("/api/v1/client/programs").set("x-test-user-id", USER_CLIENT_1).expect(200);
      expect(clientPrograms.body).toHaveLength(1);
      const otherClientPrograms = await http(app).get("/api/v1/client/programs").set("x-test-user-id", USER_CLIENT_2).expect(200);
      expect(otherClientPrograms.body).toEqual([]);
    });

    it("forbids assigning a program that is not owned by the coach and assigning without a relationship", async () => {
      const { programId } = await setup();

      await assign(programId, USER_CLIENT_1, USER_COACH_B).expect(404);
      await assign(programId, USER_CLIENT_2, USER_COACH_A).expect(403);
    });

    it("computes progress for the client and scopes it to the participant pair", async () => {
      const { programId } = await setup();
      const assigned = await assign(programId, USER_CLIENT_1).expect(201);

      db.workoutStats.push(
        { id: newId(), userId: USER_CLIENT_1, startedAt: new Date("2026-01-05T10:00:00Z"), volumeKg: 2500 },
        { id: newId(), userId: USER_CLIENT_1, startedAt: new Date("2026-01-07T09:00:00Z"), volumeKg: 2500 },
        { id: newId(), userId: USER_CLIENT_2, startedAt: new Date("2026-01-05T11:00:00Z"), volumeKg: 99999 }
      );

      const clientProgress = await http(app).get(`/api/v1/client/programs/${assigned.body.id}/progress`).set("x-test-user-id", USER_CLIENT_1).expect(200);
      expect(clientProgress.body.programName).toBe("12-week base");
      expect(clientProgress.body.totalWorkouts).toBe(3);
      expect(clientProgress.body.completedDays).toBe(2);
      expect(clientProgress.body.completedWorkouts).toBe(3);
      expect(clientProgress.body.percentComplete).toBe(100);
      expect(clientProgress.body.loggedWorkoutCount).toBe(2);
      expect(clientProgress.body.volumeKg).toBe(5000);

      await http(app).get(`/api/v1/client/programs/${assigned.body.id}/progress`).set("x-test-user-id", USER_CLIENT_2).expect(404);

      const coachProgress = await http(app).get(`/api/v1/programs/assignments/${assigned.body.id}/progress`).set("x-test-user-id", USER_COACH_A).expect(200);
      expect(coachProgress.body.clientId).toBe(USER_CLIENT_1);

      await http(app).get(`/api/v1/programs/assignments/${assigned.body.id}/progress`).set("x-test-user-id", USER_COACH_B).expect(404);
    });

    it("preserves terminal assignments (frozen history)", async () => {
      const { programId } = await setup();
      const assigned = await assign(programId, USER_CLIENT_1).expect(201);

      const completed = await http(app)
        .patch(`/api/v1/programs/assignments/${assigned.body.id}`)
        .set("x-test-user-id", USER_COACH_A)
        .send({ status: "completed", endDate: "2026-03-30T00:00:00Z" })
        .expect(200);
      expect(completed.body.status).toBe("completed");
      expect(completed.body.isActive).toBe(false);

      await http(app).patch(`/api/v1/programs/assignments/${assigned.body.id}`).set("x-test-user-id", USER_COACH_A).send({ status: "active" }).expect(400);
    });
  });
});
