import { EntityManager, Repository } from "typeorm";
import { ProgressQueueItem } from "./entities/progress-queue-item.entity";
import { Workout } from "../workout/entities/workout.entity";
import { WorkoutExercise } from "../workout/entities/workout-exercise.entity";
import { ProgressQueueService } from "./progress-queue.service";

describe("ProgressQueueService", () => {
  const USER = "user-1";

  const makeService = () => {
    const manager = { find: jest.fn(), upsert: jest.fn() };
    const queueRepo = { createQueryBuilder: jest.fn() };
    const workoutRepo = { find: jest.fn() };
    const service = new ProgressQueueService(queueRepo as unknown as Repository<ProgressQueueItem>, workoutRepo as unknown as Repository<Workout>);
    return { service, manager, queueRepo, workoutRepo };
  };

  const makeInsertChain = (identifiers: unknown[]) => {
    const chain = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: identifiers })
    };
    return chain;
  };

  it("resolves direct + indirect workout ids and upserts only owned workouts", async () => {
    const { service, manager } = makeService();
    manager.find.mockImplementation((entity: unknown) => {
      if (entity === WorkoutExercise) return Promise.resolve([{ workoutId: "w3" }]);
      return Promise.resolve([{ id: "w1" }, { id: "w3" }]);
    });

    await service.enqueueWorkoutsInTransaction(
      manager as unknown as EntityManager,
      USER,
      {
        workouts: [{ id: "w1" }],
        workoutExercises: [{ id: "we1", payload: { workoutId: "w2" } }],
        sets: [{ id: "s1", payload: { workoutExerciseId: "we-set" } }]
      },
      "modified"
    );

    expect(manager.find).toHaveBeenCalledWith(WorkoutExercise, expect.anything());
    expect(manager.find).toHaveBeenCalledWith(Workout, expect.anything());
    expect(manager.upsert).toHaveBeenCalledTimes(2);
    expect(manager.upsert).toHaveBeenCalledWith(
      ProgressQueueItem,
      expect.objectContaining({ userId: USER, workoutId: "w1", reason: "modified", status: "pending", attemptCount: 0 }),
      { conflictPaths: ["userId", "workoutId"] }
    );
    expect(manager.upsert).toHaveBeenCalledWith(ProgressQueueItem, expect.objectContaining({ userId: USER, workoutId: "w3", reason: "modified" }), {
      conflictPaths: ["userId", "workoutId"]
    });
  });

  it("does not scan workout_exercises when only workout-changed items are present", async () => {
    const { service, manager } = makeService();
    manager.find.mockResolvedValue([{ id: "w1" }]);

    await service.enqueueWorkoutsInTransaction(manager as unknown as EntityManager, USER, { workouts: [{ id: "w1" }] });

    expect(manager.find).not.toHaveBeenCalledWith(WorkoutExercise, expect.anything());
    expect(manager.upsert).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the change batch carries no resolvable ids", async () => {
    const { service, manager } = makeService();

    await service.enqueueWorkoutsInTransaction(manager as unknown as EntityManager, USER, {});

    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.upsert).not.toHaveBeenCalled();
  });

  it("enqueueUserHistory returns the number of newly enqueued rows", async () => {
    const { service, queueRepo, workoutRepo } = makeService();
    workoutRepo.find.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    const chain = makeInsertChain([{ id: 1 }, { id: 2 }]);
    queueRepo.createQueryBuilder.mockReturnValue(chain);

    await expect(service.enqueueUserHistory(USER)).resolves.toBe(2);
    expect(chain.orIgnore).toHaveBeenCalledTimes(1);
    expect(chain.values).toHaveBeenCalledWith([
      expect.objectContaining({ userId: USER, workoutId: "w1", reason: "backfill", status: "pending" }),
      expect.objectContaining({ userId: USER, workoutId: "w2", reason: "backfill", status: "pending" })
    ]);
  });

  it("enqueueUserHistory returns 0 and writes nothing when the user has no workouts", async () => {
    const { service, queueRepo, workoutRepo } = makeService();
    workoutRepo.find.mockResolvedValue([]);

    await expect(service.enqueueUserHistory(USER)).resolves.toBe(0);
    expect(queueRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
