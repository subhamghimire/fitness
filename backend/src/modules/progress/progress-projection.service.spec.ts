import { DataSource } from "typeorm";
import { ProgressProjectionService } from "./progress-projection.service";
import { ProgressQueueItem } from "./entities/progress-queue-item.entity";

type Runner = {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: { createQueryBuilder: jest.Mock; delete: jest.Mock; update: jest.Mock };
};

describe("ProgressProjectionService", () => {
  const makeSelectChain = (rows: unknown[]) => ({
    setLock: jest.fn().mockReturnThis(),
    setOnLocked: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows)
  });

  const makeUpdateChain = () => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    whereInIds: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 })
  });

  const makeRunner = (createQueryBuilder: jest.Mock): Runner => ({
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    manager: { createQueryBuilder, delete: jest.fn().mockResolvedValue({ affected: 1 }), update: jest.fn().mockResolvedValue({ affected: 1 }) }
  });

  const claimRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    userId: "user-1",
    workoutId: "workout-1",
    attemptCount: 1,
    reason: "modified",
    status: "pending",
    ...over
  });

  const makeDataSource = (claimRows: unknown[]) => {
    const claimSelectChain = makeSelectChain(claimRows);
    const claimUpdateChain = makeUpdateChain();
    const claimManagerQb = jest.fn((entity?: unknown) => (entity ? claimSelectChain : claimUpdateChain));
    const claimRunner = makeRunner(claimManagerQb);
    const handleRunner = makeRunner(jest.fn());
    const recoveryChain = makeUpdateChain();
    let created = 0;
    const createQueryRunner = jest.fn(() => (created++ === 0 ? claimRunner : handleRunner));
    const ds = {
      createQueryBuilder: jest.fn(() => recoveryChain),
      createQueryRunner
    } as unknown as DataSource;
    return { ds, claimRunner, handleRunner, claimSelectChain, claimUpdateChain, recoveryChain, createQueryRunner };
  };

  it("claims pending rows with SKIP LOCKED, marks them processing and deletes each on success", async () => {
    const { ds, claimRunner, handleRunner, claimUpdateChain } = makeDataSource([claimRow()]);
    const service = new ProgressProjectionService(ds);
    jest.spyOn(service, "recomputeWorkout").mockResolvedValue(undefined);

    const result = await service.processQueue(25);

    expect(result).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(claimUpdateChain.whereInIds).toHaveBeenCalledWith([1]);
    expect(claimUpdateChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: "processing" }));
    expect(claimRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(handleRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(handleRunner.manager.delete).toHaveBeenCalledWith(ProgressQueueItem, { id: 1 });
  });

  it("does nothing when the claim returns no rows", async () => {
    const { ds, claimUpdateChain, createQueryRunner } = makeDataSource([]);
    const service = new ProgressProjectionService(ds);

    const result = await service.processQueue(25);

    expect(result).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(claimUpdateChain.whereInIds).not.toHaveBeenCalled();
    expect(createQueryRunner).toHaveBeenCalledTimes(1);
  });

  it("requeues a failed workout to pending and never deletes its queue row", async () => {
    const { ds, handleRunner } = makeDataSource([claimRow({ attemptCount: 1 })]);
    const service = new ProgressProjectionService(ds);
    jest.spyOn(service, "recomputeWorkout").mockRejectedValue(new Error("boom"));

    const result = await service.processQueue(25);

    expect(result).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(handleRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(handleRunner.manager.update).toHaveBeenCalledWith(ProgressQueueItem, { id: 1 }, expect.objectContaining({ status: "pending", lastError: "boom" }));
    expect(handleRunner.manager.delete).not.toHaveBeenCalled();
  });

  it("marks a workout permanently failed once attempts are exhausted", async () => {
    const { ds, handleRunner } = makeDataSource([claimRow({ attemptCount: 5 })]);
    const service = new ProgressProjectionService(ds);
    jest.spyOn(service, "recomputeWorkout").mockRejectedValue(new Error("boom"));

    const result = await service.processQueue(25);

    expect(result.failed).toBe(1);
    expect(handleRunner.manager.update).toHaveBeenCalledWith(ProgressQueueItem, { id: 1 }, expect.objectContaining({ status: "failed" }));
  });

  it("harvests stale processing rows before claiming", async () => {
    const { ds, recoveryChain } = makeDataSource([]);
    const service = new ProgressProjectionService(ds);

    await service.processQueue(25);

    expect(recoveryChain.andWhere).toHaveBeenCalledWith(expect.stringContaining("10 minutes"));
    expect(recoveryChain.set).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
  });
});
