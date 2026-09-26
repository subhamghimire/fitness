import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CoachClientRelationship } from "../coach-client/entities/coach-client-relationship.entity";
import { RelationshipStatus } from "../coach-client/enums";
import { Coach } from "../coach/entities/coach.entity";
import { Program } from "../program/entities/program.entity";
import { ProgramAssignment } from "../program/entities/program-assignment.entity";
import { ProgramDay } from "../program/entities/program-day.entity";
import { ProgramWorkout } from "../program/entities/program-workout.entity";
import { ACTIVE_ASSIGNMENT_STATUSES, ProgramAssignmentStatus } from "../program/enums/program.enum";
import { ExerciseStat } from "../progress/entities/exercise-stat.entity";
import { PersonalRecord } from "../progress/entities/personal-record.entity";
import { WorkoutExerciseStat } from "../progress/entities/workout-exercise-stat.entity";
import { WorkoutStat } from "../progress/entities/workout-stat.entity";
import { ProgressService } from "../progress/progress.service";
import { PersonalRecordType } from "../progress/enums/progress.enum";
import { User } from "../users/entities/user.entity";
import { Workout } from "../workout/entities/workout.entity";
import { CoachDashboardService } from "./coach-dashboard.service";

interface Qb {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  addGroupBy: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  limit: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  innerJoin: jest.Mock;
  addCommonTableExpression: jest.Mock;
  from: jest.Mock;
  setParameters: jest.Mock;
  getQuery: jest.Mock;
  getParameters: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
  getCount: jest.Mock;
  getMany: jest.Mock;
}

type QbOpts = {
  rawOne?: unknown;
  rawMany?: unknown[];
  count?: number;
  many?: unknown[];
  query?: string;
  parameters?: Record<string, unknown>;
};

const makeQb = (opts: QbOpts = {}): Qb => {
  const qb = {} as Qb;
  const chained = [
    "select",
    "addSelect",
    "where",
    "andWhere",
    "groupBy",
    "addGroupBy",
    "orderBy",
    "addOrderBy",
    "limit",
    "skip",
    "take",
    "innerJoin",
    "addCommonTableExpression",
    "from",
    "setParameters"
  ] as const;
  for (const method of chained) qb[method] = jest.fn(() => qb);
  qb.getQuery = jest.fn().mockReturnValue(opts.query ?? "SELECT 1");
  qb.getParameters = jest.fn().mockReturnValue(opts.parameters ?? {});
  qb.getRawOne = jest.fn().mockResolvedValue(opts.rawOne ?? null);
  qb.getRawMany = jest.fn().mockResolvedValue(opts.rawMany ?? []);
  qb.getCount = jest.fn().mockResolvedValue(opts.count ?? 0);
  qb.getMany = jest.fn().mockResolvedValue(opts.many ?? []);
  return qb;
};

type RepoMock = {
  createQueryBuilder: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
};

type Mocks = {
  relationshipRepo: RepoMock;
  coachRepo: RepoMock;
  programRepo: RepoMock;
  assignmentRepo: RepoMock;
  dayRepo: RepoMock;
  workoutRepo: RepoMock;
  workoutStatsRepo: RepoMock;
  prRepo: RepoMock;
  exerciseStatsRepo: RepoMock;
  weStatsRepo: RepoMock;
  progressService: jest.Mocked<Pick<ProgressService, "overview" | "volumeHistory" | "listPersonalRecords">>;
};

const DAY_MS = 86_400_000;
const COACH_ID = "coach-a";
const USER_ID = "user-a";
const CLIENT_ID = "client-1";
const coachRow = { id: COACH_ID, userId: USER_ID } as Coach;

/** The `where` clause the service passed to a repository's first `find` call. */
const firstFindWhere = (repo: RepoMock): Record<string, unknown> => {
  const [options] = repo.find.mock.calls[0] as [{ where: Record<string, unknown> }];
  return options.where;
};

/** The SQL expressions passed to every `addSelect` call on a query builder. */
const addedSelects = (qb: Qb): string[] => (qb.addSelect.mock.calls as [string][]).map(([sql]) => sql);

const makeService = (overrides: Partial<Mocks> = {}): { service: CoachDashboardService; mocks: Mocks } => {
  const repo = (): RepoMock => ({ createQueryBuilder: jest.fn(), find: jest.fn(), findOne: jest.fn() });
  const mocks: Mocks = {
    relationshipRepo: repo(),
    coachRepo: repo(),
    programRepo: repo(),
    assignmentRepo: repo(),
    dayRepo: repo(),
    workoutRepo: repo(),
    workoutStatsRepo: repo(),
    prRepo: repo(),
    exerciseStatsRepo: repo(),
    weStatsRepo: repo(),
    progressService: {
      overview: jest.fn(),
      volumeHistory: jest.fn(),
      listPersonalRecords: jest.fn()
    },
    ...overrides
  };
  mocks.coachRepo.findOne.mockResolvedValue(coachRow);
  mocks.assignmentRepo.find.mockResolvedValue([]);

  const service = new CoachDashboardService(
    mocks.relationshipRepo as unknown as Repository<CoachClientRelationship>,
    mocks.coachRepo as unknown as Repository<Coach>,
    mocks.programRepo as unknown as Repository<Program>,
    mocks.assignmentRepo as unknown as Repository<ProgramAssignment>,
    mocks.dayRepo as unknown as Repository<ProgramDay>,
    mocks.workoutRepo as unknown as Repository<ProgramWorkout>,
    mocks.workoutStatsRepo as unknown as Repository<WorkoutStat>,
    mocks.prRepo as unknown as Repository<PersonalRecord>,
    mocks.exerciseStatsRepo as unknown as Repository<ExerciseStat>,
    mocks.weStatsRepo as unknown as Repository<WorkoutExerciseStat>,
    mocks.progressService as unknown as ProgressService
  );
  return { service, mocks };
};

const liveRelation = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "rel-1",
  status: RelationshipStatus.ACTIVE,
  startedAt: new Date(Date.now() - 30 * DAY_MS),
  clientId: CLIENT_ID,
  clientName: "Jordan",
  clientEmail: "jordan@example.com",
  ...overrides
});

const statRow = (userId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId,
  workoutCount: "4",
  volumeKg: "4000",
  reps: "200",
  setCount: "24",
  activeDays: "3",
  lastWorkoutAt: new Date(Date.now() - 2 * DAY_MS),
  ...overrides
});

const pendingRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  relationshipId: "rel-pending",
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  clientId: "client-pending",
  clientName: "Pending Client",
  clientEmail: "pending@example.com",
  ...overrides
});

const assignmentRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "asg-1",
  programId: "prog-1",
  clientId: CLIENT_ID,
  startDate: new Date(),
  endDate: null,
  status: ProgramAssignmentStatus.ACTIVE,
  ...overrides
});

const emptyOverview = {
  totalWorkouts: 0,
  totalVolumeKg: 0,
  totalReps: 0,
  totalDurationSeconds: 0,
  avgDurationSeconds: 0,
  activeDays: 0,
  firstWorkoutAt: null,
  lastWorkoutAt: null,
  weeklyWorkoutFrequency: []
};

const mockProgressReads = (mocks: Mocks): void => {
  mocks.progressService.overview.mockResolvedValue(emptyOverview);
  mocks.progressService.volumeHistory.mockResolvedValue([]);
  mocks.progressService.listPersonalRecords.mockResolvedValue({
    data: [],
    pagination: { page: 1, total: 0, limit: 5, totalPages: 0, hasNextPage: false, hasPrevPage: false }
  });
};

const configureSummaryReads = (
  mocks: Mocks,
  options: {
    relationships?: Record<string, unknown>[];
    windowStats?: Record<string, unknown>[];
    totalStats?: Record<string, unknown>[];
    workoutDays?: Record<string, unknown>[];
    prCounts?: Record<string, unknown>[];
  } = {}
): { relationshipQbs: Qb[]; workoutQbs: Qb[]; prQb: Qb } => {
  const relationships = options.relationships ?? [liveRelation()];
  const scopeQb = makeQb({ rawOne: { count: String(relationships.length), fingerprint: `fp-${relationships.length}` } });
  const relationshipQb = makeQb({ count: relationships.length, rawMany: relationships });
  mocks.relationshipRepo.createQueryBuilder.mockReturnValueOnce(scopeQb).mockReturnValueOnce(relationshipQb);

  const windowQb = makeQb({ rawMany: options.windowStats ?? [statRow(CLIENT_ID)] });
  const totalQb = makeQb({ rawMany: options.totalStats ?? [statRow(CLIENT_ID)] });
  const dayQb = makeQb({ rawMany: options.workoutDays ?? [] });
  mocks.workoutStatsRepo.createQueryBuilder.mockReturnValueOnce(windowQb).mockReturnValueOnce(totalQb).mockReturnValueOnce(dayQb);
  const prQb = makeQb({ rawMany: options.prCounts ?? [] });
  mocks.prRepo.createQueryBuilder.mockReturnValue(prQb);

  return { relationshipQbs: [scopeQb, relationshipQb], workoutQbs: [windowQb, totalQb, dayQb], prQb };
};

const configureDetailReads = (
  mocks: Mocks,
  options: {
    relationship?: Record<string, unknown> | null;
    windowStats?: Record<string, unknown>[];
    workoutDays?: Record<string, unknown>[];
    recentWorkouts?: Record<string, unknown>[];
  } = {}
): { relationshipQb: Qb; workoutQbs: Qb[] } => {
  const relationshipQb = makeQb({ rawOne: options.relationship === undefined ? liveRelation() : options.relationship });
  mocks.relationshipRepo.createQueryBuilder.mockReturnValue(relationshipQb);

  const windowQb = makeQb({ rawMany: options.windowStats ?? [] });
  const dayQb = makeQb({ rawMany: options.workoutDays ?? [] });
  const recentQb = makeQb({ rawMany: options.recentWorkouts ?? [] });
  mocks.workoutStatsRepo.createQueryBuilder.mockReturnValueOnce(windowQb).mockReturnValueOnce(dayQb).mockReturnValueOnce(recentQb);
  mocks.exerciseStatsRepo.createQueryBuilder.mockReturnValue(makeQb({ many: [] }));
  mockProgressReads(mocks);

  return { relationshipQb, workoutQbs: [windowQb, dayQb, recentQb] };
};

describe("CoachDashboardService", () => {
  const user = { id: USER_ID } as User;

  describe("authorization and privacy", () => {
    it("rejects every dashboard entry point without a coach profile", async () => {
      const { service, mocks } = makeService();
      mocks.coachRepo.findOne.mockResolvedValue(null);

      await expect(service.overview(user, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.clientSummaries(user, { page: 1, limit: 10 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.clientDetail(user, CLIENT_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.activity(user, { page: 1, limit: 20 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.pendingRequests(user, { page: 1, limit: 20 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("returns the same 404 for a client outside the coach's live relationship scope", async () => {
      const { service, mocks } = makeService();
      const relationshipQb = configureDetailReads(mocks, { relationship: null }).relationshipQb;

      await expect(service.clientDetail(user, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(relationshipQb.where).toHaveBeenCalledWith("cc.coachId = :coachId", { coachId: COACH_ID });
      expect(relationshipQb.andWhere).toHaveBeenCalledWith("cc.clientId = :clientId", { clientId: CLIENT_ID });
      expect(relationshipQb.andWhere).toHaveBeenCalledWith("cc.status IN (:...statuses)", {
        statuses: [RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED]
      });
      expect(relationshipQb.andWhere).toHaveBeenCalledWith("cc.isDeleted = :deleted", { deleted: false });
      expect(relationshipQb.andWhere).toHaveBeenCalledWith("u.isDeleted = :clientDeleted", { clientDeleted: false });
      expect(RelationshipStatus.ENDED).not.toBe(RelationshipStatus.ACTIVE);
      expect(RelationshipStatus.BLOCKED).not.toBe(RelationshipStatus.PAUSED);
    });
  });

  describe("client summaries and assignment metrics", () => {
    it("filters terminal assignments, deleted programs and expired end dates", async () => {
      const { service, mocks } = makeService();
      const reads = configureSummaryReads(mocks);
      const result = await service.clientSummaries(user, { page: 1, limit: 10 });

      expect(result.data[0].programProgress).toBeNull();
      expect(result.data[0].missedWorkouts).toBe(0);
      expect(result.data[0].workoutCountInWindow).toBe(4);

      const assignmentWhere = firstFindWhere(mocks.assignmentRepo);
      expect(assignmentWhere).toMatchObject({ coachId: COACH_ID, isActive: true, isDeleted: false });
      // Only in-window, non-terminal assignments are loaded: live statuses via
      // `In`, and an open-ended OR window so a null endDate still qualifies.
      expect(assignmentWhere.status).toMatchObject({ type: "in", value: ACTIVE_ASSIGNMENT_STATUSES });
      expect(assignmentWhere.endDate).toMatchObject({ type: "or" });
      expect(reads.relationshipQbs[0].innerJoin).toHaveBeenCalledWith("cc.client", "u");
    });

    it("matches multiple scheduled slots to the logged workout count", async () => {
      const startDate = new Date();
      const scheduledKey = startDate.toISOString().slice(0, 10);
      const { service, mocks } = makeService();
      configureSummaryReads(mocks, { workoutDays: [{ userId: CLIENT_ID, day: scheduledKey, workoutCount: "1" }] });
      mocks.assignmentRepo.find.mockResolvedValue([assignmentRow({ startDate })]);
      mocks.programRepo.find.mockResolvedValue([{ id: "prog-1", name: "Push" }]);
      mocks.dayRepo.find.mockResolvedValue([{ id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Day 1" }]);
      mocks.workoutRepo.find.mockResolvedValue([
        { id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Push A" },
        { id: "w-2", programDayId: "day-1", orderIndex: 1, name: "Push B" }
      ]);

      const result = await service.clientSummaries(user, { page: 1, limit: 10 });
      const summary = result.data[0];

      expect(summary.workoutAdherence).toEqual({
        completedTrainingDays: 1,
        expectedTrainingDays: 1,
        adherence: 1,
        windowDays: 28
      });
      expect(summary.programProgress).toEqual(
        expect.objectContaining({
          scheduledWorkouts: 2,
          completedWorkouts: 1,
          missedWorkouts: 1,
          percentComplete: 50
        })
      );
      expect(firstFindWhere(mocks.programRepo)).toEqual(expect.objectContaining({ coachId: COACH_ID, isActive: true, isDeleted: false }));
      expect(firstFindWhere(mocks.workoutRepo)).toEqual(expect.objectContaining({ isDeleted: false }));
    });

    it("returns no adherence denominator for an upcoming live assignment with nothing due", async () => {
      const { service, mocks } = makeService();
      configureSummaryReads(mocks);
      mocks.assignmentRepo.find.mockResolvedValue([assignmentRow({ status: ProgramAssignmentStatus.UPCOMING, startDate: new Date(Date.now() + 10 * DAY_MS) })]);
      mocks.programRepo.find.mockResolvedValue([{ id: "prog-1", name: "Future Plan" }]);
      mocks.dayRepo.find.mockResolvedValue([{ id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Day 1" }]);
      mocks.workoutRepo.find.mockResolvedValue([{ id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Future workout" }]);

      const result = await service.clientSummaries(user, { page: 1, limit: 10 });

      expect(result.data[0].workoutAdherence.expectedTrainingDays).toBe(0);
      expect(result.data[0].workoutAdherence.adherence).toBeNull();
      expect(result.data[0].programProgress?.scheduledWorkouts).toBe(0);
    });
  });

  describe("client detail", () => {
    it("returns detailed DTO data and missed slots only for the detail request", async () => {
      const startDate = new Date();
      const { service, mocks } = makeService();
      const reads = configureDetailReads(mocks, {
        windowStats: [statRow(CLIENT_ID)],
        workoutDays: [{ userId: CLIENT_ID, day: startDate.toISOString().slice(0, 10), workoutCount: "1" }],
        recentWorkouts: [
          {
            workoutId: "w-recent",
            name: "Push",
            startedAt: new Date(),
            durationSeconds: 3000,
            volumeKg: "2800",
            reps: "150",
            setCount: "18",
            exerciseCount: "5"
          }
        ]
      });
      mocks.assignmentRepo.find.mockResolvedValue([assignmentRow({ startDate })]);
      mocks.programRepo.find.mockResolvedValue([{ id: "prog-1", name: "Push" }]);
      mocks.dayRepo.find.mockResolvedValue([{ id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Day 1" }]);
      mocks.workoutRepo.find.mockResolvedValue([
        { id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Push A" },
        { id: "w-2", programDayId: "day-1", orderIndex: 1, name: "Push B" }
      ]);
      mocks.progressService.overview.mockResolvedValue({
        ...emptyOverview,
        totalWorkouts: 4,
        totalVolumeKg: 4000,
        weeklyWorkoutFrequency: [{ bucket: new Date("2026-09-21T00:00:00.000Z"), count: 2 }]
      });
      mocks.progressService.volumeHistory.mockResolvedValue([{ bucket: new Date("2026-09-21T00:00:00.000Z"), workoutCount: 2, volumeKg: 2000, totalReps: 100 }]);
      mocks.progressService.listPersonalRecords.mockResolvedValue({
        data: [
          {
            prType: PersonalRecordType.BEST_WEIGHT_KG,
            value: 110,
            exerciseId: "ex-1",
            exerciseName: "Bench Press",
            workoutId: "w-1",
            workoutExerciseId: "we-1",
            achievedAt: new Date(),
            isCurrent: true
          }
        ],
        pagination: { page: 1, total: 1, limit: 5, totalPages: 1, hasNextPage: false, hasPrevPage: false }
      });

      const result = await service.clientDetail(user, CLIENT_ID, {});

      expect(result.client).toEqual({ id: CLIENT_ID, name: "Jordan", email: "jordan@example.com" });
      expect(result.recentWorkouts[0].workoutId).toBe("w-recent");
      expect(result.overview.totalWorkouts).toBe(4);
      expect(result.weeklyFrequency).toHaveLength(1);
      expect(result.progressTrends[0].workoutCount).toBe(2);
      expect(result.recentPersonalRecords).toHaveLength(1);
      expect(result.missedWorkoutDetails).toEqual([expect.objectContaining({ workoutId: "w-2", workoutName: "Push B", dayId: "day-1" })]);
      expect(reads.workoutQbs.every((qb) => qb.innerJoin.mock.calls.some(([entity]) => entity === Workout))).toBe(true);
    });

    it("uses a window function to return a bounded session history for every top exercise", async () => {
      const { service, mocks } = makeService();
      configureDetailReads(mocks);
      mocks.exerciseStatsRepo.createQueryBuilder.mockReturnValue(
        makeQb({
          many: [
            {
              exerciseId: "ex-1",
              exerciseName: "Bench Press",
              workoutCount: 3,
              totalVolumeKg: 1725,
              lastPerformedAt: new Date("2026-09-24T10:00:00.000Z"),
              bestWeightKg: 110,
              bestEstimated1RmKg: 116.67,
              bestReps: 5
            },
            {
              exerciseId: "ex-2",
              exerciseName: "Squat",
              workoutCount: 2,
              totalVolumeKg: 2400,
              lastPerformedAt: new Date("2026-09-23T10:00:00.000Z"),
              bestWeightKg: 150,
              bestEstimated1RmKg: 160,
              bestReps: 3
            }
          ]
        })
      );
      const rankedQb = makeQb({ query: "SELECT ranked_source", parameters: { clientId: CLIENT_ID } });
      const outerQb = makeQb({
        rawMany: [
          { exerciseId: "ex-1", startedAt: new Date("2026-09-24T10:00:00.000Z"), bestWeightKg: 110, bestEstimated1RmKg: 116.67, bestReps: 5, volumeKg: "700" },
          { exerciseId: "ex-1", startedAt: new Date("2026-09-20T10:00:00.000Z"), bestWeightKg: 105, bestEstimated1RmKg: 110, bestReps: 5, volumeKg: "650" },
          { exerciseId: "ex-2", startedAt: new Date("2026-09-23T10:00:00.000Z"), bestWeightKg: 150, bestEstimated1RmKg: 160, bestReps: 3, volumeKg: "900" },
          { exerciseId: "ex-2", startedAt: new Date("2026-09-19T10:00:00.000Z"), bestWeightKg: 145, bestEstimated1RmKg: 155, bestReps: 3, volumeKg: "850" }
        ]
      });
      mocks.weStatsRepo.createQueryBuilder.mockReturnValueOnce(rankedQb).mockReturnValueOnce(outerQb);

      const result = await service.clientDetail(user, CLIENT_ID, { recentLimit: 2 });

      expect(result.exerciseProgression).toHaveLength(2);
      expect(result.exerciseProgression.every((exercise) => exercise.recentSessions.length === 2)).toBe(true);
      expect(rankedQb.addSelect).toHaveBeenCalledWith(expect.stringContaining("ROW_NUMBER() OVER (PARTITION BY wes.exerciseId"), "sessionRank");
      expect(rankedQb.innerJoin).toHaveBeenCalledWith(Workout, "sourceWorkout", expect.any(String));
      expect(outerQb.where).toHaveBeenCalledWith("ranked.sessionRank <= :sessionLimit", { sessionLimit: 2 });
    });
  });

  describe("pending requests and activity", () => {
    it("paginates pending requests and excludes deleted clients", async () => {
      const { service, mocks } = makeService();
      const qb = makeQb({ count: 21, rawMany: [pendingRow()] });
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.pendingRequests(user, { page: 2, limit: 10 });

      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.andWhere).toHaveBeenCalledWith("cc.status = :status", { status: RelationshipStatus.PENDING });
      expect(qb.andWhere).toHaveBeenCalledWith("u.isDeleted = :clientDeleted", { clientDeleted: false });
      expect(result.pagination).toEqual({
        total: 21,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true
      });
      expect(result.data[0].client.email).toBe("pending@example.com");
    });

    it("joins source workouts so stale deleted projections cannot enter the activity feed", async () => {
      const { service, mocks } = makeService();
      const activityQb = makeQb({
        count: 1,
        rawMany: [
          {
            workoutId: "synced-w-1",
            clientId: CLIENT_ID,
            clientName: "Jordan",
            name: "Synced Push",
            startedAt: new Date(),
            durationSeconds: 2700,
            volumeKg: "2800",
            reps: "150",
            setCount: "18",
            exerciseCount: "5"
          }
        ]
      });
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(activityQb);
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb());

      const result = await service.activity(user, { page: 1, limit: 10 });

      expect(result.data[0].workoutId).toBe("synced-w-1");
      expect(activityQb.innerJoin).toHaveBeenCalledWith(Workout, "sourceWorkout", "sourceWorkout.id = ws.workoutId AND sourceWorkout.userId = ws.userId");
      expect(activityQb.andWhere).toHaveBeenCalledWith("sourceWorkout.isDeleted = :workoutDeleted", { workoutDeleted: false });
      expect(activityQb.andWhere).toHaveBeenCalledWith("sourceWorkout.deletedAt IS NULL");
      expect(activityQb.addCommonTableExpression).toHaveBeenCalledWith(expect.anything(), "coach_live_clients");
    });

    it("attributes an overlapping-plan shortage to one plan, not both", async () => {
      // `uq_program_assignments_live` only guards one live assignment per
      // (program, client), so a client can legitimately hold a Push and a Pull
      // plan that fall on the same calendar day. One logged workout can satisfy
      // one slot, never two. Without the shared per-client credit pool the same
      // workout would be credited to both plans and this client would show zero
      // missed workouts despite having skipped a session.
      const startDate = new Date();
      const dayKey = startDate.toISOString().slice(0, 10);
      const { service, mocks } = makeService();
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb({ rawMany: [liveRelation()] }));
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(makeQb({ rawMany: [{ userId: CLIENT_ID, day: dayKey, workoutCount: "1" }] }));
      mocks.assignmentRepo.find.mockResolvedValue([assignmentRow({ id: "asg-1", programId: "prog-1", startDate }), assignmentRow({ id: "asg-2", programId: "prog-2", startDate })]);
      mocks.programRepo.find.mockResolvedValue([
        { id: "prog-1", name: "Push" },
        { id: "prog-2", name: "Pull" }
      ]);
      mocks.dayRepo.find.mockResolvedValue([
        { id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Push day" },
        { id: "day-2", programId: "prog-2", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Pull day" }
      ]);
      mocks.workoutRepo.find.mockResolvedValue([
        { id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Push A" },
        { id: "w-2", programDayId: "day-2", orderIndex: 0, name: "Pull A" }
      ]);

      const result = await service.missedWorkouts(user, { page: 1, limit: 20 });

      expect(result.pagination.total).toBe(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          clientId: CLIENT_ID,
          clientName: "Jordan",
          // The higher-ranked plan keeps the credit, so the shortage lands on Pull.
          programName: "Pull",
          workoutId: "w-2",
          // Scheduled days are bucketed to UTC midnight, not the assignment's
          // start instant, so the same workout day lines up with workout_stats.
          scheduledDate: new Date(`${dayKey}T00:00:00.000Z`),
          daysOverdue: 0
        })
      );
    });
  });

  describe("overview and cache isolation", () => {
    it("excludes paused clients and aggregates every live assignment for active clients", async () => {
      const { service, mocks } = makeService();
      const startDate = new Date();
      const dayKey = startDate.toISOString().slice(0, 10);
      const pending = pendingRow();
      const liveQb = makeQb();
      const scopeQb = makeQb({ rawOne: { count: "3", fingerprint: "fp-3" } });
      const statusQb = makeQb({
        rawMany: [
          { status: RelationshipStatus.ACTIVE, count: "1" },
          { status: RelationshipStatus.PAUSED, count: "1" },
          { status: RelationshipStatus.PENDING, count: "1" }
        ]
      });
      const relationshipsQb = makeQb({
        rawMany: [liveRelation(), liveRelation({ id: "rel-2", clientId: "paused-client", clientName: "Paused Client", status: RelationshipStatus.PAUSED })]
      });
      const pendingQb = makeQb({ rawMany: [pending] });
      let relationshipCall = 0;
      mocks.relationshipRepo.createQueryBuilder.mockImplementation(() => {
        relationshipCall += 1;
        if (relationshipCall === 1) return scopeQb;
        if (relationshipCall === 2) return statusQb;
        if (relationshipCall === 3) return relationshipsQb;
        if (relationshipCall === 8) return pendingQb;
        return liveQb;
      });

      const windowQb = makeQb({ rawMany: [statRow(CLIENT_ID), statRow("paused-client", { workoutCount: "2", activeDays: "2" })] });
      const totalQb = makeQb({ rawMany: [statRow(CLIENT_ID), statRow("paused-client", { workoutCount: "5" })] });
      const dayQb = makeQb({
        rawMany: [
          { userId: CLIENT_ID, day: dayKey, workoutCount: "1" },
          { userId: "paused-client", day: dayKey, workoutCount: "1" }
        ]
      });
      const recentWorkoutQb = makeQb({
        rawMany: [
          {
            workoutId: "workout-1",
            clientId: CLIENT_ID,
            clientName: "Jordan",
            name: "Push",
            startedAt: new Date(),
            durationSeconds: 2700,
            volumeKg: "2800",
            reps: "150",
            setCount: "18",
            exerciseCount: "5"
          }
        ]
      });
      const trendQb = makeQb({ rawMany: [{ bucket: new Date("2026-09-21T00:00:00.000Z"), workoutCount: "1", volumeKg: "2800" }] });
      const workoutQbs = [windowQb, totalQb, dayQb, recentWorkoutQb, trendQb];
      let workoutCall = 0;
      mocks.workoutStatsRepo.createQueryBuilder.mockImplementation(() => workoutQbs[workoutCall++]);

      const prCountQb = makeQb({ rawMany: [{ userId: CLIENT_ID, count: "2" }] });
      const recentPrQb = makeQb({
        rawMany: [
          {
            clientId: CLIENT_ID,
            clientName: "Jordan",
            prType: PersonalRecordType.BEST_WEIGHT_KG,
            value: "110",
            exerciseId: "ex-1",
            exerciseName: "Bench Press",
            workoutId: "workout-1",
            achievedAt: new Date()
          }
        ]
      });
      mocks.prRepo.createQueryBuilder.mockReturnValueOnce(prCountQb).mockReturnValueOnce(recentPrQb);

      mocks.assignmentRepo.find.mockResolvedValue([assignmentRow({ id: "asg-1", programId: "prog-1", startDate }), assignmentRow({ id: "asg-2", programId: "prog-2", startDate })]);
      mocks.programRepo.find.mockResolvedValue([
        { id: "prog-1", name: "Push" },
        { id: "prog-2", name: "Pull" }
      ]);
      mocks.dayRepo.find.mockResolvedValue([
        { id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Push day" },
        { id: "day-2", programId: "prog-2", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Pull day" }
      ]);
      mocks.workoutRepo.find.mockResolvedValue([
        { id: "workout-slot-1", programDayId: "day-1", orderIndex: 0, name: "Push" },
        { id: "workout-slot-2", programDayId: "day-2", orderIndex: 0, name: "Pull" }
      ]);

      const result = await service.overview(user, { windowDays: 28 });

      expect(result.activeClientCount).toBe(1);
      expect(result.pausedClientCount).toBe(1);
      expect(result.pendingRequestCount).toBe(1);
      expect(result.activeClients).toHaveLength(1);
      expect(result.activeClients[0].client.id).toBe(CLIENT_ID);
      expect(result.pendingRequests[0].relationshipId).toBe(pending.relationshipId);
      expect(result.programProgress).toEqual({
        activeAssignments: 2,
        scheduledWorkouts: 2,
        // Both programs schedule a slot on the same calendar day and the client
        // logged ONE workout that day, so exactly one slot is satisfied. A
        // per-assignment lookup would credit the same workout to both plans and
        // report a perfect week for a single session.
        completedWorkouts: 1,
        missedWorkouts: 1,
        percentComplete: 50
      });
      expect(result.workoutAdherence).toEqual({
        completedTrainingDays: 1,
        expectedTrainingDays: 2,
        adherence: 0.5,
        windowDays: 28
      });
      expect(result.recentPersonalRecords[0]).toEqual(expect.objectContaining({ clientId: CLIENT_ID, clientName: "Jordan", value: 110 }));
      expect(recentPrQb.innerJoin).toHaveBeenCalledWith(Workout, "sourceWorkout", expect.any(String));
      expect(trendQb.innerJoin).toHaveBeenCalledWith(Workout, "sourceWorkout", expect.any(String));
    });

    it("versions aggregate caches by relationship state before serving cached PII", async () => {
      const { service, mocks } = makeService();
      const firstListQb = makeQb({ count: 1, rawMany: [liveRelation({ clientName: "First Name" })] });
      const secondListQb = makeQb({ count: 1, rawMany: [liveRelation({ clientName: "Second Name" })] });
      const firstScopeQb = makeQb({ rawOne: { count: "1", fingerprint: "fp-same" } });
      const cachedScopeQb = makeQb({ rawOne: { count: "1", fingerprint: "fp-same" } });
      const changedScopeQb = makeQb({ rawOne: { count: "2", fingerprint: "fp-changed" } });
      let relationshipCall = 0;
      mocks.relationshipRepo.createQueryBuilder.mockImplementation(() => {
        relationshipCall += 1;
        if (relationshipCall === 1) return firstScopeQb;
        if (relationshipCall === 2) return firstListQb;
        if (relationshipCall === 3) return cachedScopeQb;
        if (relationshipCall === 4) return changedScopeQb;
        return secondListQb;
      });
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(makeQb());
      mocks.prRepo.createQueryBuilder.mockReturnValue(makeQb());

      const first = await service.clientSummaries(user, { page: 1, limit: 10 });
      const cached = await service.clientSummaries(user, { page: 1, limit: 10 });
      const changed = await service.clientSummaries(user, { page: 1, limit: 10 });

      expect(first.data[0].client.name).toBe("First Name");
      expect(cached.data[0].client.name).toBe("First Name");
      expect(changed.data[0].client.name).toBe("Second Name");
      expect(firstListQb.getRawMany).toHaveBeenCalledTimes(1);
      expect(secondListQb.getRawMany).toHaveBeenCalledTimes(1);
      expect(firstScopeQb.innerJoin).toHaveBeenCalledWith("cc.client", "u");
    });

    it("derives the cache namespace from a per-row fingerprint, not a max timestamp", async () => {
      const { service, mocks } = makeService();
      const scopeQb = makeQb({ rawOne: { count: "2", fingerprint: "fp-abc" } });
      mocks.relationshipRepo.createQueryBuilder.mockReturnValueOnce(scopeQb).mockReturnValueOnce(makeQb({ count: 1, rawMany: [liveRelation()] }));
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(makeQb());
      mocks.prRepo.createQueryBuilder.mockReturnValue(makeQb());

      await service.clientSummaries(user, { page: 1, limit: 10 });

      const selected = addedSelects(scopeQb);
      // A `MAX(updated_at)` namespace is not monotonic across rows: ending one
      // relationship while another row keeps a later timestamp would leave the
      // namespace untouched and keep serving the ended client's PII.
      expect(selected.some((sql) => /string_agg/i.test(sql))).toBe(true);
      expect(selected.some((sql) => /MAX\s*\(/i.test(sql))).toBe(false);
    });
  });
});
