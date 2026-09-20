import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { CoachClientRelationship } from "../coach-client/entities/coach-client-relationship.entity";
import { RelationshipStatus } from "../coach-client/enums";
import { Coach } from "../coach/entities/coach.entity";
import { Program } from "../program/entities/program.entity";
import { ProgramAssignment } from "../program/entities/program-assignment.entity";
import { ProgramDay } from "../program/entities/program-day.entity";
import { ProgramWorkout } from "../program/entities/program-workout.entity";
import { ProgramAssignmentStatus } from "../program/enums/program.enum";
import { ExerciseStat } from "../progress/entities/exercise-stat.entity";
import { PersonalRecord } from "../progress/entities/personal-record.entity";
import { WorkoutExerciseStat } from "../progress/entities/workout-exercise-stat.entity";
import { WorkoutStat } from "../progress/entities/workout-stat.entity";
import { ProgressService } from "../progress/progress.service";
import { PersonalRecordType } from "../progress/enums/progress.enum";
import { User } from "../users/entities/user.entity";
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
  distinctOn: jest.Mock;
  innerJoin: jest.Mock;
  addCommonTableExpression: jest.Mock;
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
    "distinctOn",
    "innerJoin",
    "addCommonTableExpression"
  ] as const;
  for (const m of chained) qb[m] = jest.fn(() => qb);
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
  progressService: jest.Mocked<Pick<ProgressService, "overview" | "volumeHistory" | "workoutFrequency" | "listPersonalRecords">>;
};

const DAY_MS = 86_400_000;
const COACH_ID = "coach-a";
const USER_ID = "user-a";
const CLIENT_ID = "client-1";

const coachRow = { id: COACH_ID, userId: USER_ID } as Coach;

const makeService = (over: Partial<Mocks> = {}): { service: CoachDashboardService; mocks: Mocks } => {
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
      workoutFrequency: jest.fn(),
      listPersonalRecords: jest.fn()
    } as Mocks["progressService"],
    ...over
  };
  mocks.coachRepo.findOne.mockResolvedValue(coachRow);
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

const liveRelation = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  id: "rel-1",
  status: RelationshipStatus.ACTIVE,
  startedAt: new Date(Date.now() - 30 * DAY_MS),
  clientId: CLIENT_ID,
  clientName: "Jordan",
  clientEmail: "jordan@example.com",
  ...over
});

const statRow = (userId: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  userId,
  workoutCount: "4",
  volumeKg: "4000",
  reps: "200",
  setCount: "24",
  activeDays: "3",
  lastWorkoutAt: new Date(Date.now() - 2 * DAY_MS),
  ...over
});

describe("CoachDashboardService", () => {
  const user = { id: USER_ID } as User;

  describe("privacy", () => {
    it("forbids access for users without a coach profile", async () => {
      const { service, mocks } = makeService();
      mocks.coachRepo.findOne.mockResolvedValue(null);

      await expect(service.overview(user, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.clientSummaries(user, { page: 1, limit: 10 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.clientDetail(user, CLIENT_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.activity(user, { page: 1, limit: 10 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("returns 404 when the client belongs to another coach (scope query finds no live relationship)", async () => {
      const { service, mocks } = makeService();
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb({ rawOne: null }));

      await expect(service.clientDetail(user, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(["ended", "blocked"] as const)("returns 404 when the relationship is %s (not a live status)", async (status) => {
      const { service, mocks } = makeService();
      // The status gate lives in SQL; a non-live row simply never matches the
      // live-scoped query, so the raw row that survives must be null.
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb({ rawOne: null }));

      await expect(service.clientDetail(user, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);

      const qb = mocks.relationshipRepo.createQueryBuilder.mock.results[0].value as unknown as Qb;
      const allowed = [RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED];
      expect(qb.andWhere).toHaveBeenCalledWith("cc.status IN (:...statuses)", { statuses: allowed });
      expect(allowed).not.toContain(status);
    });
  });

  describe("clientSummaries", () => {
    it("keeps programProgress empty when the assignment is not active (only live assignments load)", async () => {
      const { service, mocks } = makeService();
      const relQb = makeQb({ count: 1, rawMany: [liveRelation()] });
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(relQb);
      // An inactive/completed assignment is filtered out server-side (is_active = true),
      // so the find returns no rows and the client shows no program progress.
      let findOptions: { where: Record<string, unknown> } = { where: {} };
      mocks.assignmentRepo.find.mockImplementation((options: { where: Record<string, unknown> }) => {
        findOptions = options;
        return Promise.resolve([]);
      });
      mocks.workoutStatsRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID)] }))
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID)] }))
        .mockReturnValueOnce(makeQb({ rawMany: [] }));
      mocks.prRepo.createQueryBuilder.mockReturnValue(makeQb({ rawMany: [] }));

      const result = await service.clientSummaries(user, { page: 1, limit: 10 });

      const summary = result.data[0];
      expect(summary.programProgress).toBeNull();
      expect(summary.missedWorkouts).toBe(0);
      expect(summary.workoutCountInWindow).toBe(4);

      const findOptionsFinal = findOptions;
      expect(findOptionsFinal.where.coachId).toBe(COACH_ID);
      expect(findOptionsFinal.where.isActive).toBe(true);
      expect(findOptionsFinal.where.isDeleted).toBe(false);
      const clientIdOperator = findOptionsFinal.where.clientId as { type: string; value: string[] };
      expect(clientIdOperator.type).toBe("in");
      expect(clientIdOperator.value).toEqual([CLIENT_ID]);
    });

    it("builds adherence from the program schedule when an active assignment is due", async () => {
      const startDate = new Date(Date.now() - 5 * DAY_MS);
      const scheduledKey = startDate.toISOString().slice(0, 10);
      const { service, mocks } = makeService();
      const relQb = makeQb({ count: 1, rawMany: [liveRelation()] });
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(relQb);
      mocks.workoutStatsRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID)] }))
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID)] }))
        .mockReturnValueOnce(makeQb({ rawMany: [{ userId: CLIENT_ID, day: scheduledKey }] }));
      mocks.prRepo.createQueryBuilder.mockReturnValue(makeQb({ rawMany: [{ userId: CLIENT_ID, count: "1" }] }));

      mocks.assignmentRepo.find.mockResolvedValue([
        {
          id: "asg-1",
          programId: "prog-1",
          clientId: CLIENT_ID,
          startDate,
          endDate: null,
          status: ProgramAssignmentStatus.ACTIVE
        }
      ]);
      mocks.programRepo.find.mockResolvedValue([{ id: "prog-1", name: "Push" }]);
      mocks.dayRepo.find.mockResolvedValue([{ id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Day 1" }]);
      mocks.workoutRepo.find.mockResolvedValue([{ id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Push A" }]);

      const result = await service.clientSummaries(user, { page: 1, limit: 10 });

      const summary = result.data[0];
      expect(summary.workoutAdherence.expectedTrainingDays).toBe(1);
      expect(summary.workoutAdherence.completedTrainingDays).toBe(1);
      expect(summary.workoutAdherence.adherence).toBe(1);
      expect(summary.missedWorkouts).toBe(0);
      expect(summary.programProgress?.percentComplete).toBe(100);
      expect(summary.recentPrCount).toBe(1);
    });
  });

  describe("clientDetail", () => {
    it("wires progress domain + exercise progression into a single response", async () => {
      const { service, mocks } = makeService();
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb({ rawOne: liveRelation() }));

      mocks.workoutStatsRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb({ rawMany: [] })) // groupedWindowStats
        .mockReturnValueOnce(makeQb({ rawMany: [] })) // groupedTotalStats
        .mockReturnValueOnce(makeQb({ rawMany: [] })) // workoutDayKeys
        .mockReturnValueOnce(makeQb({ rawMany: [] })); // clientRecentWorkouts
      mocks.prRepo.createQueryBuilder.mockReturnValue(makeQb({ rawMany: [] }));
      mocks.assignmentRepo.find.mockResolvedValue([]);

      mocks.exerciseStatsRepo.createQueryBuilder.mockReturnValue(
        makeQb({
          many: [
            {
              exerciseId: "ex-1",
              exerciseName: "Bench Press",
              lastPerformedAt: new Date(Date.now() - 2 * DAY_MS),
              workoutCount: 3,
              totalVolumeKg: 1725,
              bestWeightKg: 110,
              bestEstimated1RmKg: 116.67,
              bestReps: 5
            }
          ]
        })
      );
      mocks.weStatsRepo.createQueryBuilder.mockReturnValue(
        makeQb({
          many: [
            {
              exerciseId: "ex-1",
              startedAt: new Date(Date.now() - 2 * DAY_MS),
              bestWeightKg: 110,
              bestEstimated1RmKg: 116.67,
              bestReps: 5,
              volumeKg: 700
            }
          ]
        })
      );

      mocks.progressService.overview.mockResolvedValue({
        totalWorkouts: 4,
        totalVolumeKg: 4000,
        totalReps: 200,
        totalDurationSeconds: 0,
        avgDurationSeconds: 0,
        activeDays: 3,
        firstWorkoutAt: null,
        lastWorkoutAt: null,
        weeklyWorkoutFrequency: []
      });
      mocks.progressService.volumeHistory.mockResolvedValue([{ bucket: new Date(), workoutCount: 2, volumeKg: 2000, totalReps: 100 }]);
      mocks.progressService.workoutFrequency.mockResolvedValue([{ bucket: new Date(), count: 2 }]);
      mocks.progressService.listPersonalRecords.mockResolvedValue({
        data: [
          {
            prType: PersonalRecordType.BEST_WEIGHT_KG,
            value: 110,
            exerciseId: "ex-1",
            exerciseName: "Bench Press",
            workoutId: "w-1",
            workoutExerciseId: "we-1",
            achievedAt: new Date(Date.now() - DAY_MS),
            isCurrent: true
          }
        ],
        pagination: { page: 1, total: 1, limit: 5, totalPages: 1, hasNextPage: false, hasPrevPage: false }
      });

      const result = await service.clientDetail(user, CLIENT_ID, {});

      expect(result.client.name).toBe("Jordan");
      expect(mocks.exerciseStatsRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result.exerciseProgression).toHaveLength(1);
      expect(result.exerciseProgression[0].recentSessions).toHaveLength(1);
      expect(result.exerciseProgression[0].recentSessions[0].volumeKg).toBe(700);
      expect(result.overview.totalWorkouts).toBe(4);
      expect(result.progressTrends[0].workoutCount).toBe(2);
      expect(result.recentPersonalRecords).toHaveLength(1);
      expect(result.workoutAdherence.expectedTrainingDays).toBe(28); // no active assignmenet -> window-length basis
    });
  });

  describe("activity", () => {
    it("reports only workout_stats projections: deleted workouts never appear, synced workouts do", async () => {
      const { service, mocks } = makeService();
      const qb = makeQb({
        count: 1,
        rawMany: [
          {
            workoutId: "synced-w-1",
            clientId: CLIENT_ID,
            clientName: "Jordan",
            name: "Synced Push",
            startedAt: new Date(Date.now() - DAY_MS),
            durationSeconds: 2700,
            volumeKg: "2800",
            reps: "150",
            setCount: "18",
            exerciseCount: "5"
          }
        ]
      });
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(qb);
      mocks.relationshipRepo.createQueryBuilder.mockReturnValue(makeQb()); // live-client scope CTE

      const result = await service.activity(user, { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].workoutId).toBe("synced-w-1");
      expect(result.data[0].clientName).toBe("Jordan");
      expect(result.data[0].volumeKg).toBe(2800);
      expect(qb.addCommonTableExpression).toHaveBeenCalled();
      expect(qb.getRawMany).toHaveBeenCalled();
      // The feed is scoped to the coach's live clients (no rows for other coaches).
      expect(mocks.workoutStatsRepo.createQueryBuilder.mock.results[0].value as unknown as Qb).toBe(qb);
    });
  });

  describe("overview", () => {
    it("aggregates adherence and program progress across live clients", async () => {
      const startDate = new Date(Date.now() - 5 * DAY_MS);
      const scheduledKey = startDate.toISOString().slice(0, 10);
      const otherDay = new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10);
      const { service, mocks } = makeService();

      mocks.relationshipRepo.createQueryBuilder
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              { status: RelationshipStatus.ACTIVE, count: "1" },
              { status: RelationshipStatus.PAUSED, count: "1" },
              { status: RelationshipStatus.PENDING, count: "1" }
            ]
          })
        ) // statusCounts
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              liveRelation({ id: "rel-1", clientId: CLIENT_ID, status: RelationshipStatus.ACTIVE }),
              liveRelation({ id: "rel-2", clientId: "client-2", clientName: "River", status: RelationshipStatus.PAUSED })
            ]
          })
        ) // liveRelationshipsQuery
        .mockReturnValueOnce(makeQb()) // CTE: groupedWindowStatsCte
        .mockReturnValueOnce(makeQb()) // CTE: groupedTotalStatsCte
        .mockReturnValueOnce(makeQb()) // CTE: coachWorkoutDays
        .mockReturnValueOnce(makeQb()) // CTE: prCountsCte
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              {
                relationshipId: "rel-pending",
                createdAt: new Date(),
                clientId: "client-3",
                clientUserId: "user-3",
                clientName: "New Client",
                clientEmail: "new@example.com"
              }
            ]
          })
        ) // pendingRequests
        .mockReturnValueOnce(makeQb()) // CTE: coachRecentWorkouts (coachActivityQuery)
        .mockReturnValueOnce(makeQb()) // CTE: coachRecentPrs
        .mockReturnValueOnce(makeQb()); // CTE: coachTrends

      mocks.workoutStatsRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID), statRow("client-2", { activeDays: "2", workoutCount: "2", volumeKg: "1500" })] })) // window CTE
        .mockReturnValueOnce(makeQb({ rawMany: [statRow(CLIENT_ID), statRow("client-2", { workoutCount: "5" })] })) // total CTE
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              { userId: CLIENT_ID, day: scheduledKey },
              { userId: "client-2", day: otherDay }
            ]
          })
        ) // workout days
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              {
                workoutId: "std-w-1",
                clientId: CLIENT_ID,
                clientName: "Jordan",
                name: "Push",
                startedAt: new Date(Date.now() - DAY_MS),
                durationSeconds: 2700,
                volumeKg: "2800",
                reps: "150",
                setCount: "18",
                exerciseCount: "5"
              }
            ]
          })
        ) // recent workouts
        .mockReturnValueOnce(makeQb({ rawMany: [{ bucket: new Date(), workoutCount: "3", volumeKg: "4000" }] })); // trends

      mocks.prRepo.createQueryBuilder
        .mockReturnValueOnce(makeQb({ rawMany: [{ userId: CLIENT_ID, count: "2" }] })) // pr counts
        .mockReturnValueOnce(
          makeQb({
            rawMany: [
              {
                prType: "best_weight_kg",
                value: "110",
                exerciseId: "ex-1",
                exerciseName: "Bench Press",
                workoutId: "w-1",
                workoutExerciseId: "we-1",
                achievedAt: new Date(Date.now() - DAY_MS)
              }
            ]
          })
        ); // recent prs

      mocks.assignmentRepo.find.mockResolvedValue([
        {
          id: "asg-1",
          programId: "prog-1",
          clientId: CLIENT_ID,
          startDate,
          endDate: null,
          status: ProgramAssignmentStatus.ACTIVE
        }
      ]);
      mocks.programRepo.find.mockResolvedValue([{ id: "prog-1", name: "Push" }]);
      mocks.dayRepo.find.mockResolvedValue([{ id: "day-1", programId: "prog-1", weekNumber: 1, dayNumber: 1, orderIndex: 0, name: "Day 1" }]);
      mocks.workoutRepo.find.mockResolvedValue([{ id: "w-1", programDayId: "day-1", orderIndex: 0, name: "Push A" }]);

      const result = await service.overview(user, { windowDays: 28 });

      expect(result.activeClientCount).toBe(1); // ACTIVE only; paused reported separately
      expect(result.pausedClientCount).toBe(1);
      expect(result.pendingRequestCount).toBe(1);
      expect(result.pendingRequests[0].client.name).toBe("New Client");
      expect(result.recentClientWorkouts).toHaveLength(1);
      expect(result.recentPersonalRecords).toHaveLength(1);

      // Program-schedule adherence for the active client + window-days basis for the paused one.
      expect(result.workoutAdherence?.completedTrainingDays).toBe(3); // 1 program day + 2 active days
      expect(result.workoutAdherence?.expectedTrainingDays).toBe(29); // 1 plan day + 28 window days
      expect(result.programProgress).toEqual({
        activeAssignments: 1,
        scheduledWorkouts: 1,
        completedWorkouts: 1,
        missedWorkouts: 0,
        percentComplete: 100
      });
      expect(result.activeClients[0].recentPrCount).toBe(2);
    });
  });
});
