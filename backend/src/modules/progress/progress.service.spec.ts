import { Repository } from "typeorm";
import { ExerciseStat } from "./entities/exercise-stat.entity";
import { PersonalRecord } from "./entities/personal-record.entity";
import { WorkoutExerciseStat } from "./entities/workout-exercise-stat.entity";
import { WorkoutStat } from "./entities/workout-stat.entity";
import { PersonalRecordType, VolumeGranularity } from "./enums/progress.enum";
import { ProgressService } from "./progress.service";

interface Qb {
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  groupBy: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  setParameter: jest.Mock;
  getRawOne: jest.Mock;
  getRawMany: jest.Mock;
}

const makeQb = (opts: { rawOne?: unknown; rawMany?: unknown } = {}): Qb => {
  const qb = {} as Qb;
  const self = (): Qb => qb;
  qb.select = jest.fn(self);
  qb.addSelect = jest.fn(self);
  qb.where = jest.fn(self);
  qb.andWhere = jest.fn(self);
  qb.groupBy = jest.fn(self);
  qb.orderBy = jest.fn(self);
  qb.limit = jest.fn(self);
  qb.setParameter = jest.fn(self);
  qb.getRawOne = jest.fn().mockResolvedValue(opts.rawOne);
  qb.getRawMany = jest.fn().mockResolvedValue(opts.rawMany ?? []);
  return qb;
};

type RepoMock = {
  find: jest.Mock;
  findAndCount: jest.Mock;
  createQueryBuilder: jest.Mock;
};

describe("ProgressService", () => {
  const USER = "user-1";

  type Mocks = {
    workoutStatsRepo: RepoMock;
    weStatsRepo: RepoMock;
    exerciseStatsRepo: RepoMock;
    prRepo: RepoMock;
  };

  const makeService = (over: Partial<Mocks> = {}): { service: ProgressService; mocks: Mocks } => {
    const repo = (): RepoMock => ({ find: jest.fn(), findAndCount: jest.fn(), createQueryBuilder: jest.fn() });
    const mocks: Mocks = {
      workoutStatsRepo: repo(),
      weStatsRepo: repo(),
      exerciseStatsRepo: repo(),
      prRepo: repo(),
      ...over
    };
    const service = new ProgressService(
      mocks.workoutStatsRepo as unknown as Repository<WorkoutStat>,
      mocks.weStatsRepo as unknown as Repository<WorkoutExerciseStat>,
      mocks.exerciseStatsRepo as unknown as Repository<ExerciseStat>,
      mocks.prRepo as unknown as Repository<PersonalRecord>
    );
    return { service, mocks };
  };

  const exerciseStat = (over: Partial<ExerciseStat> = {}): ExerciseStat =>
    ({
      exerciseId: "ex1",
      exerciseName: "Bench Press",
      workoutCount: 3,
      totalVolumeKg: 1725,
      totalReps: 17,
      firstPerformedAt: new Date("2026-01-05T10:00:00Z"),
      lastPerformedAt: new Date("2026-01-12T10:00:00Z"),
      bestWeightKg: 110,
      bestWeightWorkoutId: "w2",
      bestWeightWorkoutExerciseId: "we2",
      bestWeightAt: new Date("2026-01-07T10:00:00Z"),
      bestReps: 5,
      bestRepsWorkoutId: "w3",
      bestRepsWorkoutExerciseId: "we4",
      bestRepsAt: new Date("2026-01-12T10:00:00Z"),
      bestVolumeKg: null,
      bestVolumeWorkoutId: null,
      bestVolumeWorkoutExerciseId: null,
      bestVolumeAt: null,
      bestEstimated1RmKg: 116.67,
      best1RmWorkoutId: "w1",
      best1RmWorkoutExerciseId: "we1",
      best1RmAt: new Date("2026-01-05T10:00:00Z"),
      bestDistanceM: null,
      bestDistanceWorkoutId: null,
      bestDistanceWorkoutExerciseId: null,
      bestDistanceAt: null,
      bestTimeSeconds: null,
      bestTimeWorkoutId: null,
      bestTimeWorkoutExerciseId: null,
      bestTimeAt: null,
      ...over
    }) as ExerciseStat;

  describe("overview", () => {
    it("coerces aggregate values and includes the weekly frequency series", async () => {
      const { service, mocks } = makeService();
      const aggregate = makeQb({
        rawOne: {
          totalWorkouts: "3",
          totalVolumeKg: "1725",
          totalReps: "17",
          totalDurationSeconds: "7800",
          avgDurationSeconds: "2600",
          activeDays: "3",
          firstWorkoutAt: new Date("2026-01-05T10:00:00Z"),
          lastWorkoutAt: new Date("2026-01-12T10:00:00Z")
        }
      });
      const frequency = makeQb({
        rawMany: [
          { bucket: new Date("2026-01-12T00:00:00Z"), count: "1" },
          { bucket: new Date("2026-01-05T00:00:00Z"), count: "2" }
        ]
      });
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValueOnce(aggregate).mockReturnValueOnce(frequency);

      const result = await service.overview(USER, { weeks: 12 });

      expect(result.totalWorkouts).toBe(3);
      expect(result.totalVolumeKg).toBe(1725);
      expect(result.totalReps).toBe(17);
      expect(result.activeDays).toBe(3);
      expect(aggregate.addSelect).toHaveBeenCalledWith('COUNT(DISTINCT (ws."started_at"::date))', "activeDays");
      expect(result.weeklyWorkoutFrequency.map((b) => b.count)).toEqual([2, 1]);
    });
  });

  describe("volumeHistory", () => {
    it("binds granularity/user and optional range, then maps raw rows", async () => {
      const { service, mocks } = makeService();
      const qb = makeQb({ rawMany: [{ bucket: new Date(), workoutCount: "2", volumeKg: "1225", totalReps: "13" }] });
      mocks.workoutStatsRepo.createQueryBuilder.mockReturnValue(qb);

      const from = new Date("2026-01-01T00:00:00Z");
      const to = new Date("2026-01-31T00:00:00Z");
      const result = await service.volumeHistory(USER, { granularity: VolumeGranularity.WEEK, from, to });

      expect(qb.setParameter).toHaveBeenCalledWith("granularity", VolumeGranularity.WEEK);
      expect(qb.where).toHaveBeenCalledWith("ws.userId = :userId", { userId: USER });
      expect(qb.andWhere).toHaveBeenCalledWith("ws.startedAt >= :from", { from });
      expect(qb.andWhere).toHaveBeenCalledWith("ws.startedAt <= :to", { to });
      expect(result[0].workoutCount).toBe(2);
      expect(result[0].volumeKg).toBe(1225);
      expect(result[0].totalReps).toBe(13);
    });
  });

  describe("listExercises", () => {
    it("maps absolute bests into self-contained DTOs and paginates", async () => {
      const { service, mocks } = makeService();
      mocks.exerciseStatsRepo.findAndCount.mockResolvedValue([[exerciseStat()], 1]);

      const result = await service.listExercises(USER, { page: 1, limit: 10 });

      expect(result.pagination.total).toBe(1);
      const bestWeight = result.data[0].bestWeightKg;
      expect(bestWeight.value).toBe(110);
      expect(bestWeight.workoutId).toBe("w2");
      expect(bestWeight.workoutExerciseId).toBe("we2");
      expect(bestWeight.achievedAt).toBeInstanceOf(Date);
      expect(result.data[0].bestVolumeKg).toEqual({ value: null, workoutId: null, workoutExerciseId: null, achievedAt: null });
    });
  });

  describe("listPersonalRecords", () => {
    it("flags the record matching the exercise stat reference as current", async () => {
      const { service, mocks } = makeService();
      const records = [
        { prType: PersonalRecordType.BEST_WEIGHT_KG, value: 110, exerciseId: "ex1", workoutId: "w2", workoutExerciseId: "we2", achievedAt: new Date("2026-01-07T10:00:00Z") },
        { prType: PersonalRecordType.BEST_WEIGHT_KG, value: 100, exerciseId: "ex1", workoutId: "w1", workoutExerciseId: "we1", achievedAt: new Date("2026-01-05T10:00:00Z") },
        { prType: PersonalRecordType.BEST_REPS, value: 5, exerciseId: "ex1", workoutId: "w3", workoutExerciseId: "we4", achievedAt: new Date("2026-01-12T10:00:00Z") },
        { prType: PersonalRecordType.BEST_REPS, value: 20, exerciseId: null, workoutId: "w9", workoutExerciseId: "we9", achievedAt: new Date("2026-01-01T10:00:00Z") }
      ];
      mocks.prRepo.findAndCount.mockResolvedValue([records, records.length]);
      mocks.exerciseStatsRepo.find.mockResolvedValue([exerciseStat()]);

      const result = await service.listPersonalRecords(USER, { page: 1, limit: 20 });

      expect(result.data[0].isCurrent).toBe(true); // best_weight_kg -> w2/we2 matches stat
      expect(result.data[1].isCurrent).toBe(false); // superseded weight PR
      expect(result.data[2].isCurrent).toBe(true); // best_reps -> w3/we4 matches stat
      expect(result.data[3].isCurrent).toBe(false); // exercise with no stat
    });
  });

  describe("exerciseHistory", () => {
    it("attaches the parent workout name and applies range filters", async () => {
      const { service, mocks } = makeService();
      const session = {
        workoutId: "w1",
        workoutExerciseId: "we1",
        name: "Bench Press",
        startedAt: new Date("2026-01-05T10:00:00Z"),
        setCount: 2,
        reps: 8,
        volumeKg: 800,
        bestWeightKg: 100,
        bestReps: 5,
        bestEstimated1RmKg: 116.67,
        bestDistanceM: null,
        bestTimeSeconds: null
      };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        getMany: jest.fn().mockResolvedValue([session])
      };
      mocks.weStatsRepo.createQueryBuilder.mockReturnValue(qb);
      mocks.workoutStatsRepo.find.mockResolvedValue([{ workoutId: "w1", name: "Push Day" }]);

      const from = new Date("2026-01-01T00:00:00Z");
      const result = await service.exerciseHistory(USER, "ex1", { page: 1, limit: 20, from });

      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining("startedAt >="), { from });
      expect(result.data[0].workoutName).toBe("Push Day");
      expect(result.pagination.total).toBe(1);
    });
  });
});
