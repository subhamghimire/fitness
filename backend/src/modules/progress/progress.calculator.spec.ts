import { PersonalRecordType } from "./enums/progress.enum";
import { epleyOneRepMax, computeWorkoutStat, computeSessionStat, aggregateExerciseStats, detectPersonalRecords, SessionInput, SessionStat } from "./progress.calculator";

describe("progress.calculator", () => {
  const started = (day: number): Date => new Date(Date.UTC(2026, 0, day, 10, 0, 0));

  const set = (over: Partial<SessionInput["sets"][number]> = {}): SessionInput["sets"][number] => ({
    weight: 100,
    reps: 5,
    rpe: 8,
    isWarmup: false,
    isDropset: false,
    isFailure: false,
    durationSeconds: null,
    distance: null,
    orderIndex: 0,
    ...over
  });

  describe("epleyOneRepMax", () => {
    it("uses the Epley formula weight × (1 + reps / 30)", () => {
      expect(epleyOneRepMax(100, 5)).toBeCloseTo(116.67, 1);
      expect(epleyOneRepMax(80, 10)).toBeCloseTo(106.67, 1);
      expect(epleyOneRepMax(50, 30)).toBeCloseTo(100, 1);
    });

    it("is 0 for non-positive weight or reps", () => {
      expect(epleyOneRepMax(0, 5)).toBe(0);
      expect(epleyOneRepMax(100, 0)).toBe(0);
    });
  });

  describe("computeWorkoutStat", () => {
    it("excludes warm-up sets from volume, reps and set count but keeps drop sets", () => {
      const sessions: SessionInput[] = [
        {
          workoutId: "w1",
          workoutExerciseId: "we1",
          exerciseId: "ex1",
          name: "Bench Press",
          startedAt: started(1),
          sets: [
            set({ orderIndex: 0, isWarmup: true, weight: 60, reps: 8 }),
            set({ orderIndex: 1, weight: 100, reps: 5 }),
            set({ orderIndex: 2, weight: 100, reps: 3, isDropset: true })
          ]
        },
        {
          workoutId: "w1",
          workoutExerciseId: "we2",
          exerciseId: "ex2",
          name: "Squat",
          startedAt: started(1),
          sets: [set({ weight: 120, reps: 3 })]
        }
      ];

      const stat = computeWorkoutStat(
        {
          workoutId: "w1",
          name: "Push",
          startedAt: started(1),
          endedAt: started(1),
          durationSeconds: null
        },
        sessions
      );

      // working sets: bench 100x5, bench 100x3(drop), squat 120x3
      expect(stat.setCount).toBe(3);
      expect(stat.volumeKg).toBe(100 * 5 + 100 * 3 + 120 * 3);
      expect(stat.reps).toBe(11);
      expect(stat.exerciseCount).toBe(2);
    });

    it("falls back to started/ended delta when durationSeconds is null", () => {
      const stat = computeWorkoutStat({ workoutId: "w1", name: null, startedAt: started(1), endedAt: new Date(started(1).getTime() + 90_000), durationSeconds: null }, []);
      expect(stat.durationSeconds).toBe(90);
    });

    it("prefers explicit durationSeconds and treats empty workout as zero", () => {
      const stat = computeWorkoutStat({ workoutId: "w1", name: null, startedAt: started(1), endedAt: null, durationSeconds: 1800 }, [
        { workoutId: "w1", workoutExerciseId: "we1", exerciseId: "ex1", name: null, startedAt: started(1), sets: [] }
      ]);
      expect(stat.durationSeconds).toBe(1800);
      expect(stat.volumeKg).toBe(0);
      expect(stat.setCount).toBe(0);
    });
  });

  describe("computeSessionStat", () => {
    it("computes bests and session volume from working sets", () => {
      const session: SessionInput = {
        workoutId: "w1",
        workoutExerciseId: "we1",
        exerciseId: "ex1",
        name: "Bench Press",
        startedAt: started(1),
        sets: [
          set({ orderIndex: 0, isWarmup: true, weight: 60, reps: 8 }),
          set({ orderIndex: 1, weight: 100, reps: 5, distance: null, durationSeconds: 30 }),
          set({ orderIndex: 2, weight: 110, reps: 2 }),
          set({ orderIndex: 3, weight: 100, reps: 8, distance: 800, durationSeconds: null })
        ]
      };

      const stat = computeSessionStat(session);
      expect(stat.setCount).toBe(3);
      expect(stat.bestWeightKg).toBe(110);
      expect(stat.bestReps).toBe(8);
      expect(stat.bestEstimated1RmKg).toBeCloseTo(126.67, 1); // 100 × (1 + 8/30)
      expect(stat.bestDistanceM).toBe(800);
      expect(stat.bestTimeSeconds).toBe(30);
      expect(stat.volumeKg).toBe(100 * 5 + 110 * 2 + 100 * 8);
    });

    it("returns null bests when there are no working sets", () => {
      const stat = computeSessionStat({
        workoutId: "w1",
        workoutExerciseId: "we1",
        exerciseId: "ex1",
        name: null,
        startedAt: started(1),
        sets: [set({ isWarmup: true, weight: 60, reps: 8 })]
      });
      expect(stat.bestWeightKg).toBeNull();
      expect(stat.bestReps).toBeNull();
      expect(stat.volumeKg).toBe(0);
    });
  });

  const sessionStat = (over: Partial<SessionStat>): SessionStat => ({
    workoutId: "w1",
    workoutExerciseId: "we1",
    exerciseId: "ex1",
    name: "Bench Press",
    startedAt: started(1),
    setCount: 3,
    reps: 10,
    volumeKg: 1000,
    bestWeightKg: 100,
    bestReps: 5,
    bestEstimated1RmKg: 116.67,
    bestDistanceM: null,
    bestTimeSeconds: null,
    ...over
  });

  describe("aggregateExerciseStats / detectPersonalRecords", () => {
    it("emits a PR only when a running best is strictly exceeded", () => {
      const sessions: SessionStat[] = [
        sessionStat({ workoutId: "w1", workoutExerciseId: "we1", startedAt: started(1), bestWeightKg: 100, volumeKg: 1000 }),
        sessionStat({ workoutId: "w2", workoutExerciseId: "we2", startedAt: started(5), bestWeightKg: 105, volumeKg: 1000 }),
        // equal to best — must NOT emit a duplicate PR
        sessionStat({ workoutId: "w3", workoutExerciseId: "we3", startedAt: started(8), bestWeightKg: 105, volumeKg: 2000 })
      ];

      const records = detectPersonalRecords(sessions);
      const weightPrs = records.filter((r) => r.prType === PersonalRecordType.BEST_WEIGHT_KG);
      expect(weightPrs).toHaveLength(2);
      expect(weightPrs[0].value).toBe(100);
      expect(weightPrs[0].workoutId).toBe("w1");
      expect(weightPrs[1].value).toBe(105);
      expect(weightPrs[1].workoutId).toBe("w2");

      const aggregate = aggregateExerciseStats(sessions);
      expect(aggregate.best[PersonalRecordType.BEST_WEIGHT_KG]).toMatchObject({ value: 105, workoutId: "w2" });
      expect(aggregate.totalVolumeKg).toBe(4000);
      expect(aggregate.workoutCount).toBe(3);
      expect(aggregate.firstPerformedAt?.getTime()).toBe(started(1).getTime());
      expect(aggregate.lastPerformedAt?.getTime()).toBe(started(8).getTime());
    });

    it("regenerates the chain deterministically: an edit that removes a record drops it from PRs", () => {
      const before: SessionStat[] = [
        sessionStat({ workoutId: "w1", workoutExerciseId: "we1", startedAt: started(1), bestWeightKg: 100 }),
        sessionStat({ workoutId: "w2", workoutExerciseId: "we2", startedAt: started(2), bestWeightKg: 120 })
      ];
      // Workout w2 edited so the best set dropped back to 105kg.
      const after: SessionStat[] = [
        sessionStat({ workoutId: "w1", workoutExerciseId: "we1", startedAt: started(1), bestWeightKg: 100 }),
        sessionStat({ workoutId: "w2", workoutExerciseId: "we2", startedAt: started(2), bestWeightKg: 105 })
      ];

      const beforeRecords = detectPersonalRecords(before);
      const afterRecords = detectPersonalRecords(after);

      expect(beforeRecords.filter((r) => r.prType === PersonalRecordType.BEST_WEIGHT_KG).map((r) => r.value)).toEqual([100, 120]);
      // The 120 record must not survive the edit.
      expect(afterRecords.filter((r) => r.prType === PersonalRecordType.BEST_WEIGHT_KG).map((r) => r.value)).toEqual([100, 105]);
      expect(afterRecords.some((r) => r.value === 120)).toBe(false);
    });

    it("deleted workouts contribute nothing to the aggregate", () => {
      const aggregate = aggregateExerciseStats([]);
      expect(aggregate.workoutCount).toBe(0);
      expect(aggregate.totalVolumeKg).toBe(0);
      expect(aggregate.firstPerformedAt).toBeNull();
      expect(aggregate.best).toEqual({});
      expect(detectPersonalRecords([])).toEqual([]);
    });

    it("tracks distance and time records for conditioning sets", () => {
      const sessions: SessionStat[] = [
        sessionStat({ startedAt: started(1), bestWeightKg: null, bestEstimated1RmKg: null, bestReps: null, volumeKg: 0, bestDistanceM: 500, bestTimeSeconds: 120 }),
        sessionStat({ startedAt: started(2), bestWeightKg: null, bestEstimated1RmKg: null, bestReps: null, volumeKg: 0, bestDistanceM: 1000, bestTimeSeconds: 240 })
      ];
      const records = detectPersonalRecords(sessions);
      expect(records.map((r) => `${r.prType}:${r.value}`)).toEqual(["best_distance_m:500", "best_time_seconds:120", "best_distance_m:1000", "best_time_seconds:240"]);
    });
  });
});
