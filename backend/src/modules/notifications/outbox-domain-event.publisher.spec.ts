import { DataSource, EntityManager } from "typeorm";
import { DomainAggregateType, DomainEvent, DomainEventType } from "src/common/events";
import { DomainEventOutboxStatus } from "./enums";
import { OutboxDomainEventPublisher } from "./outbox-domain-event.publisher";

/**
 * OUTBOX-BACKED DOMAIN EVENT PUBLISHER
 *
 * The two properties this class exists for, and the two this suite defends:
 *
 *   - `publishInTransaction` inserts the occurrence **inside the caller's
 *     transaction**, so a committed business write always has its event and a
 *     rolled-back one never leaves a phantom event behind.
 *   - `publish` (the standalone path) **never rejects**: an outbox outage in a
 *     non-transactional producer is logged and the business call carries on,
 *     because losing a notification must never be a reason the business action
 *     fails. That is also why a duplicate insert is a no-op: the idempotency
 *     key makes a replayed occurrence a second case of "nothing to do".
 */

const makeEvent = (idempotencyKey: string = `${DomainEventType.WORKOUT_COMPLETED}:w-1`): DomainEvent =>
  ({
    type: DomainEventType.WORKOUT_COMPLETED,
    occurredAt: new Date("2026-02-02T12:00:00Z"),
    idempotencyKey,
    actorId: "user-1",
    audience: { kind: "user_and_active_coach", userId: "user-1", excludeActor: false },
    aggregate: { type: DomainAggregateType.WORKOUT, id: "w-1" },
    payload: { workoutId: "w-1", workoutName: "Push Day", startedAt: "2026-02-02T10:00:00.000Z", endedAt: null, durationSeconds: 3600 }
  }) as unknown as DomainEvent;

/** The joined insert-chain surface the publisher reaches through. */
interface InsertChain {
  insert: jest.Mock;
  into: jest.Mock;
  values: jest.Mock;
  orIgnore: jest.Mock;
  execute: jest.Mock;
}

const makePublisher = () => {
  const execute = jest.fn<Promise<{ raw: { id: string }[] }>, []>(() => Promise.resolve({ raw: [{ id: "outbox-1" }] }));
  let inserted: Record<string, unknown> | null = null;

  const chain: InsertChain = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn((v: Record<string, unknown>) => {
      inserted = v;
      return chain;
    }),
    orIgnore: jest.fn().mockReturnThis(),
    execute
  };

  // The manager handed to `publishInTransaction`. Its query builder is the only
  // one the transaction path may use.
  const txnQueryBuilder = jest.fn(() => chain);
  const manager = { createQueryBuilder: txnQueryBuilder } as unknown as EntityManager;

  // The DataSource's own manager is poisoned: the transactional path must prove
  // it writes through the manager it was handed, never through this one.
  const datasourceQueryBuilder = jest.fn(() => {
    throw new Error("must not use the DataSource manager inside a transaction");
  });
  const dataSource = { manager: { createQueryBuilder: datasourceQueryBuilder } } as unknown as DataSource;

  const publisher = new OutboxDomainEventPublisher(dataSource);
  return {
    publisher,
    manager,
    execute,
    insert: chain.insert,
    orIgnore: chain.orIgnore,
    values: (): Record<string, unknown> | null => inserted,
    txnQueryBuilder,
    datasourceQueryBuilder
  };
};

describe("OutboxDomainEventPublisher — publishInTransaction", () => {
  it("inserts the occurrence as one row in the caller's transaction", async () => {
    const { publisher, manager, execute, values, txnQueryBuilder, datasourceQueryBuilder } = makePublisher();

    await publisher.publishInTransaction(manager, makeEvent());

    // The write goes through the *caller's* manager, never the publisher's own,
    // so it commits or rolls back with the business transaction it was handed.
    expect(txnQueryBuilder).toHaveBeenCalledTimes(1);
    expect(datasourceQueryBuilder).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(values()).toMatchObject({
      eventType: DomainEventType.WORKOUT_COMPLETED,
      aggregateType: DomainAggregateType.WORKOUT,
      aggregateId: "w-1",
      actorId: "user-1",
      idempotencyKey: `${DomainEventType.WORKOUT_COMPLETED}:w-1`,
      status: DomainEventOutboxStatus.PENDING,
      attemptCount: 0
    });
    expect(values()?.audience).toEqual({ kind: "user_and_active_coach", userId: "user-1", excludeActor: false });
    expect(values()?.payload).toMatchObject({ workoutId: "w-1" });
  });

  it("is a no-op insert for a re-published occurrence (the idempotency key)", async () => {
    // The unique index on idempotency_key means the retried insert matches
    // nothing. The single `orIgnore()` is the whole story — no read-modify-write
    // dance that could race a concurrent producer.
    const { publisher, manager, execute, orIgnore } = makePublisher();

    await publisher.publishInTransaction(manager, makeEvent());
    await publisher.publishInTransaction(manager, makeEvent());

    expect(execute).toHaveBeenCalledTimes(2);
    expect(orIgnore).toHaveBeenCalledTimes(2);
  });

  it("resolves for an occurrence with any dedupe key the producer chooses", async () => {
    const { publisher, manager } = makePublisher();

    await expect(publisher.publishInTransaction(manager, makeEvent(`${DomainEventType.WORKOUT_COMPLETED}:w-1`))).resolves.toBeUndefined();
  });
});

describe("OutboxDomainEventPublisher — publish (standalone)", () => {
  it("never rejects when the outbox write fails", async () => {
    const { publisher, execute } = makePublisher();
    execute.mockRejectedValue(new Error("connection reset"));

    // The business action already succeeded; an unavailable outbox must not be
    // allowed to turn it into a 500.
    await expect(publisher.publish(makeEvent())).resolves.toBeUndefined();
  });

  it("never rejects when the outbox is entirely unavailable", async () => {
    const { publisher, datasourceQueryBuilder } = makePublisher();
    datasourceQueryBuilder.mockImplementation(() => {
      throw new Error("outbox down");
    });

    await expect(publisher.publish(makeEvent())).resolves.toBeUndefined();
  });
});
