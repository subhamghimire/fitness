import { Repository } from "typeorm";
import { DomainAggregateType, DomainEventType } from "src/common/events";
import { DomainEventOutbox } from "./entities/domain-event-outbox.entity";
import { NOTIFICATION_DELIVERY_MAX_ATTEMPTS } from "./entities/notification-delivery.entity";
import { DomainEventOutboxStatus, NotificationChannel, NotificationType } from "./enums";
import { NotificationAudienceResolver } from "./notification-audience.resolver";
import { NotificationEventHandler } from "./notification-event.handler";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationRenderer, RenderedNotification } from "./notification-renderer";
import { EffectivePreferences, NotificationsService } from "./notifications.service";

/**
 * NOTIFICATION EVENT HANDLER  (pipeline stage 2)
 *
 * The two properties this suite exists to defend are the ones that make the
 * outbox design worth the machinery:
 *
 *   - CREATION. One domain event produces exactly one in-app notification per
 *     resolved recipient, with the rendered copy and a dedupe key that is stable
 *     per (occurrence, recipient) — never per attempt.
 *
 *   - DUPLICATE HANDLING. The relay can redeliver, BullMQ can retry, two
 *     workers can race. Handling the same outbox row any number of times must
 *     converge on one notification and one delivery per channel. The test that
 *     matters most is the *second* pass: it must report `duplicate` and write
 *     nothing, and it must still repair a delivery that a crashed first attempt
 *     never scheduled.
 */

const OUTBOX = "77777777-7777-4777-8777-777777777777";
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const WORKOUT = "55555555-5555-4555-8555-555555555555";

const RENDERED: RenderedNotification = {
  type: NotificationType.WORKOUT_COMPLETED,
  title: "Workout completed",
  body: 'Alice finished "Push Day"',
  actionUrl: `/workouts/${WORKOUT}`,
  data: { workoutId: WORKOUT }
};

const makeOutboxRow = (idempotencyKey: string = `${DomainEventType.WORKOUT_COMPLETED}:${WORKOUT}`): DomainEventOutbox =>
  ({
    id: OUTBOX,
    eventType: DomainEventType.WORKOUT_COMPLETED,
    aggregateType: DomainAggregateType.WORKOUT,
    aggregateId: WORKOUT,
    actorId: ALICE,
    audience: { kind: "user_and_active_coach", userId: ALICE, excludeActor: false },
    payload: { workoutId: WORKOUT, workoutName: "Push Day", startedAt: "2026-02-02T10:00:00.000Z", endedAt: null, durationSeconds: 3600 },
    idempotencyKey,
    status: DomainEventOutboxStatus.DISPATCHED,
    attemptCount: 1,
    nextAttemptAt: new Date("2026-02-02T11:05:00Z"),
    lastError: null,
    dispatchedAt: new Date("2026-02-02T11:00:00Z"),
    processedAt: null,
    createdAt: new Date("2026-02-02T11:00:00Z"),
    updatedAt: new Date("2026-02-02T11:00:00Z")
  }) as DomainEventOutbox;

const makePrefs = (overrides: Partial<EffectivePreferences> = {}): EffectivePreferences => ({
  inAppEnabled: true,
  pushEnabled: true,
  emailEnabled: true,
  mutedTypes: [],
  deviceTokens: ["device-1"],
  ...overrides
});

/**
 * An in-memory stand-in for the `(user_id, dedupe_key)` unique index.
 *
 * Modelling the index rather than a repository mock is what makes the duplicate
 * tests meaningful: `created` is derived from whether the key is already taken,
 * exactly as the real `ON CONFLICT DO NOTHING` behaves, so the assertions hold
 * for the same reason they would in production.
 */
const makeService = (options: { outbox?: DomainEventOutbox | null; recipients?: string[]; preferences?: Record<string, EffectivePreferences> } = {}) => {
  const outbox = "outbox" in options ? (options.outbox ?? null) : makeOutboxRow();
  const recipients = options.recipients ?? [BOB];
  const preferences = options.preferences ?? {};

  const notifications = new Map<string, { id: string; userId: string; dedupeKey: string }>();
  const deliveries = new Map<string, { id: string; notificationId: string; channel: NotificationChannel }>();
  let notificationSeq = 0;
  let deliverySeq = 0;

  const findOutbox = jest.fn<Promise<DomainEventOutbox | null>, [string]>().mockResolvedValue(outbox);
  const outboxUpdate = jest
    .fn<Promise<{ affected: number }>, [{ id: string; status: DomainEventOutboxStatus }, { processedAt: Date | null; lastError: string | null }]>()
    .mockResolvedValue({ affected: 1 });

  const resolveAudience = jest.fn<Promise<string[]>, [unknown, string | null]>().mockResolvedValue(recipients);

  const render = jest.fn<Promise<RenderedNotification>, [unknown]>().mockResolvedValue(RENDERED);

  const resolvePrefs = jest.fn((userId: string): EffectivePreferences => preferences[userId] ?? makePrefs());

  const createFromEvent = jest.fn(
    (input: {
      userId: string;
      dedupeKey: string;
      type: NotificationType;
      title: string;
      body: string;
      actionUrl: string | null;
      sourceType: string;
      sourceId: string;
    }): { notification: { id: string; userId: string; dedupeKey: string }; created: boolean } => {
      const existing = [...notifications.values()].find((n) => n.userId === input.userId && n.dedupeKey === input.dedupeKey);
      if (existing) return { notification: existing, created: false };
      const notification = { ...input, id: `n${++notificationSeq}` };
      notifications.set(notification.id, notification);
      return { notification, created: true };
    }
  );

  const createDelivery = jest.fn(
    (
      notificationId: string,
      userId: string,
      channel: NotificationChannel,
      maxAttempts: number
    ): { id: string; notificationId: string; userId: string; channel: NotificationChannel } | null => {
      const existing = [...deliveries.values()].find((d) => d.notificationId === notificationId && d.channel === channel);
      if (existing) return null;
      const delivery = { id: `d${++deliverySeq}`, notificationId, userId, channel };
      deliveries.set(delivery.id, delivery);
      void maxAttempts;
      return delivery;
    }
  );

  const enqueueDelivery = jest.fn().mockResolvedValue(undefined);

  const outboxRepo = { findOne: findOutbox, update: outboxUpdate } as unknown as Repository<DomainEventOutbox>;
  const audienceResolver = { resolve: resolveAudience } as unknown as NotificationAudienceResolver;
  const renderer = { render } as unknown as NotificationRenderer;
  const notificationsService = {
    resolvePreferences: resolvePrefs,
    createFromEvent,
    createDelivery
  } as unknown as NotificationsService;
  const queueService = { enqueueDelivery } as unknown as NotificationQueueService;

  const handler = new NotificationEventHandler(outboxRepo, audienceResolver, renderer, notificationsService, queueService);

  return { handler, findOutbox, outboxUpdate, resolveAudience, render, resolvePrefs, createFromEvent, createDelivery, enqueueDelivery, notifications, deliveries };
};

describe("NotificationEventHandler — creating notifications", () => {
  it("creates one in-app notification per resolved recipient", async () => {
    const { handler, notifications, enqueueDelivery } = makeService({ recipients: [BOB, CAROL] });

    const result = await handler.handle(OUTBOX);

    expect(result.status).toBe("processed");
    expect(result.eventType).toBe(DomainEventType.WORKOUT_COMPLETED);
    expect(result.recipients).toBe(2);
    expect(result.notificationsCreated).toBe(2);
    expect(notifications.size).toBe(2);

    // The rendered copy is what the user reads, and it carries the deep link.
    for (const notification of notifications.values()) {
      expect(notification).toMatchObject({ type: NotificationType.WORKOUT_COMPLETED, title: "Workout completed", body: RENDERED.body, actionUrl: RENDERED.actionUrl });
    }
    // Push and email are *scheduled*, not sent: this stage performs no provider
    // I/O at all, so a slow provider can never stall or fail event handling.
    expect(enqueueDelivery).toHaveBeenCalledTimes(4);
  });

  it("keys each notification by occurrence AND recipient, so two recipients never collide", async () => {
    const { handler, notifications } = makeService({ recipients: [BOB, CAROL] });

    await handler.handle(OUTBOX);

    const keys = [...notifications.values()].map((n) => n.dedupeKey);
    expect(keys).toEqual([`${DomainEventType.WORKOUT_COMPLETED}:${WORKOUT}:${BOB}`, `${DomainEventType.WORKOUT_COMPLETED}:${WORKOUT}:${CAROL}`]);
  });

  it("resolves the audience at handling time, not at publish time", async () => {
    // The producer declared only "the athlete and their active coaches".
    const { handler, resolveAudience, notifications } = makeService({ recipients: [ALICE, BOB] });

    await handler.handle(OUTBOX);

    // Who that is was decided now, so a coach added since the workout finished
    // is still told — and the producer never had to know what "active" means.
    expect(resolveAudience).toHaveBeenCalledWith(expect.objectContaining({ kind: "user_and_active_coach" }), ALICE);
    expect([...notifications.values()].map((n) => n.userId)).toEqual([ALICE, BOB]);
  });

  it("marks the outbox row processed and clears any relay error", async () => {
    const { handler, outboxUpdate } = makeService();

    await handler.handle(OUTBOX);

    // Scoped to `status = DISPATCHED` so a row claimed by another relay is
    // never stamped by this one.
    const [where, patch] = outboxUpdate.mock.calls[0];
    expect(where).toMatchObject({ id: OUTBOX, status: DomainEventOutboxStatus.DISPATCHED });
    expect(patch.processedAt).toBeInstanceOf(Date);
    expect(patch.lastError).toBeNull();
  });

  it("is a no-op when the event resolves to nobody, and still marks the row", async () => {
    const { handler, outboxUpdate, notifications, enqueueDelivery } = makeService({ recipients: [] });

    const result = await handler.handle(OUTBOX);

    expect(result).toMatchObject({ status: "processed", recipients: 0, notificationsCreated: 0 });
    expect(notifications.size).toBe(0);
    expect(enqueueDelivery).not.toHaveBeenCalled();
    expect(outboxUpdate).toHaveBeenCalled();
  });

  it("skips an outbox row that has since been deleted", async () => {
    const { handler, notifications, outboxUpdate } = makeService({ outbox: null });

    const result = await handler.handle(OUTBOX);

    // A relay can dispatch a row that a concurrent cleanup removed; that is not
    // an error, it is nothing to do.
    expect(result.status).toBe("skipped");
    expect(notifications.size).toBe(0);
    expect(outboxUpdate).not.toHaveBeenCalled();
  });
});

describe("NotificationEventHandler — duplicate event handling", () => {
  /** The headline guarantee: replaying an occurrence notifies nobody twice. */
  it("produces nothing new when the same outbox row is handled twice", async () => {
    const { handler, notifications, deliveries, enqueueDelivery } = makeService({ recipients: [BOB] });

    const first = await handler.handle(OUTBOX);
    const second = await handler.handle(OUTBOX);

    expect(first).toMatchObject({ status: "processed", notificationsCreated: 1 });
    expect(second).toMatchObject({ status: "duplicate", notificationsCreated: 0, duplicatesSkipped: 1 });

    // One row, one delivery per channel, one enqueue per channel.
    expect(notifications.size).toBe(1);
    expect(deliveries.size).toBe(2);
    expect(enqueueDelivery).toHaveBeenCalledTimes(2);
  });

  it("converges when a redelivery races itself across many replays", async () => {
    const { handler, notifications } = makeService({ recipients: [BOB, CAROL] });

    const results = await Promise.all([handler.handle(OUTBOX), handler.handle(OUTBOX), handler.handle(OUTBOX), handler.handle(OUTBOX)]);

    // The unique index is the authority: however the jobs interleave, exactly
    // one notification per recipient survives and nothing double-sends.
    expect(notifications.size).toBe(2);
    expect(results.reduce((sum, r) => sum + r.notificationsCreated, 0)).toBe(2);
    expect(results.reduce((sum, r) => sum + r.duplicatesSkipped, 0)).toBe(6);
  });

  /**
   * A crashed first attempt can leave the notification behind without ever
   * creating the delivery rows. The replay repairs that rather than leaving the
   * user permanently un-pushed.
   */
  it("repairs a delivery the crashed first attempt never scheduled", async () => {
    const { handler, createDelivery, enqueueDelivery, deliveries } = makeService({ recipients: [BOB] });
    const workingCreateDelivery = createDelivery.getMockImplementation()!;

    // First attempt: the in-app row is written, then the process dies before
    // any delivery row is created.
    createDelivery.mockImplementation(() => null);
    await handler.handle(OUTBOX);
    expect(deliveries.size).toBe(0);
    expect(enqueueDelivery).not.toHaveBeenCalled();

    // Replay: the notification already exists, so nothing new is materialised —
    // but the missing deliveries are created and scheduled on this pass.
    createDelivery.mockImplementation(workingCreateDelivery);
    const result = await handler.handle(OUTBOX);

    expect(result.notificationsCreated).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.deliveriesScheduled).toBe(2);
    expect(enqueueDelivery).toHaveBeenCalledTimes(2);
  });

  it("does not re-schedule a delivery that already exists", async () => {
    const { handler, createDelivery, enqueueDelivery } = makeService({ recipients: [BOB] });

    await handler.handle(OUTBOX);
    enqueueDelivery.mockClear();

    // `createDelivery` returning null is how the real service reports "already
    // scheduled"; nothing may be enqueued on top of it.
    createDelivery.mockImplementation(() => null);
    const result = await handler.handle(OUTBOX);

    expect(result.deliveriesScheduled).toBe(0);
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("treats two distinct occurrences of the same aggregate as distinct", async () => {
    // Dedupe is per occurrence, never per aggregate: a workout that is
    // un-finished and finished again is two legitimate notifications.
    const first = makeService({ recipients: [BOB] });
    const again = makeService({ outbox: makeOutboxRow(`${DomainEventType.WORKOUT_COMPLETED}:${WORKOUT}:second-session`), recipients: [BOB] });

    await first.handler.handle(OUTBOX);
    await again.handler.handle(OUTBOX);

    expect([...first.notifications.values()][0].dedupeKey).not.toBe([...again.notifications.values()][0].dedupeKey);
  });
});

describe("NotificationEventHandler — preferences gate delivery scheduling", () => {
  it("creates nothing at all for a muted kind, so un-muting cannot resurrect it", async () => {
    const { handler, notifications, enqueueDelivery } = makeService({ recipients: [BOB], preferences: { [BOB]: makePrefs({ mutedTypes: [NotificationType.WORKOUT_COMPLETED] }) } });

    const result = await handler.handle(OUTBOX);

    expect(result.notificationsCreated).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    expect(notifications.size).toBe(0);
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("still notifies the recipients who did not mute the kind", async () => {
    const { handler, notifications } = makeService({
      recipients: [BOB, CAROL],
      preferences: { [BOB]: makePrefs({ mutedTypes: [NotificationType.WORKOUT_COMPLETED] }) }
    });

    const result = await handler.handle(OUTBOX);

    // Muting is per user, not global: CAROL still hears about the workout.
    expect(result.notificationsCreated).toBe(1);
    expect([...notifications.values()].map((n) => n.userId)).toEqual([CAROL]);
  });

  it("schedules only the channels the recipient has enabled", async () => {
    const { handler, enqueueDelivery } = makeService({ recipients: [BOB], preferences: { [BOB]: makePrefs({ emailEnabled: false }) } });

    const result = await handler.handle(OUTBOX);

    expect(result.deliveriesScheduled).toBe(1);
    expect(enqueueDelivery).toHaveBeenCalledTimes(1);
    expect(enqueueDelivery).toHaveBeenCalledWith(expect.objectContaining({ channel: NotificationChannel.PUSH }));
  });

  it("schedules no push for a recipient with no registered device", async () => {
    const { handler, enqueueDelivery } = makeService({ recipients: [BOB], preferences: { [BOB]: makePrefs({ deviceTokens: [] }) } });

    const result = await handler.handle(OUTBOX);

    // Not deliverable, not failed: no job is created, so the ledger stays clean
    // and nothing retries forever against a device that does not exist.
    expect(result.deliveriesScheduled).toBe(1);
    expect(enqueueDelivery).toHaveBeenCalledWith(expect.objectContaining({ channel: NotificationChannel.EMAIL }));
  });

  it("schedules no email either when both provider channels are off", async () => {
    const { handler, enqueueDelivery } = makeService({ recipients: [BOB], preferences: { [BOB]: makePrefs({ pushEnabled: false, emailEnabled: false }) } });

    const result = await handler.handle(OUTBOX);

    // The in-app row still exists — the inbox is not gated on push/email.
    expect(result.notificationsCreated).toBe(1);
    expect(result.deliveriesScheduled).toBe(0);
    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("gives every new delivery the configured retry budget", async () => {
    const { handler, createDelivery } = makeService({ recipients: [BOB] });

    await handler.handle(OUTBOX);

    // The retry budget is passed straight through to the ledger.
    expect(createDelivery).toHaveBeenNthCalledWith(1, expect.any(String), BOB, NotificationChannel.PUSH, NOTIFICATION_DELIVERY_MAX_ATTEMPTS);
    expect(createDelivery).toHaveBeenNthCalledWith(2, expect.any(String), BOB, NotificationChannel.EMAIL, NOTIFICATION_DELIVERY_MAX_ATTEMPTS);
  });
});
