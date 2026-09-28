import { Repository } from "typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { Notification, NotificationDelivery } from "./entities";
import { NOTIFICATION_DELIVERY_MAX_ATTEMPTS } from "./entities/notification-delivery.entity";
import { NotificationChannel, NotificationDeliveryStatus } from "./enums";
import { NotificationDeliveryProcessor } from "./notification-delivery.processor";
import { EffectivePreferences, NotificationsService } from "./notifications.service";
import { EmailNotificationProvider, PushNotificationProvider } from "./providers/notification-provider";

/**
 * NOTIFICATION DELIVERY PROCESSOR  (stages 3 + 4)
 *
 * This is the only place in the pipeline that talks to a provider, so it is the
 * only place where a provider can cause harm. The suite is built around the
 * distinction that matters operationally:
 *
 *   - RETRYABLE. A transient provider fault (5xx, rate limit, network reset)
 *     must not lose the notification. The ledger stays `PENDING`, the error is
 *     recorded, and the backoff grows.
 *   - TERMINAL. Success is final, and a row that is already `SENT` short-circuits
 *     — a redelivered job must never send the same notification twice.
 *   - NOT AN ERROR. Opting out between scheduling and delivery, a push with no
 *     device, or a notification whose user has vanished are all `skipped`, not
 *     failures: retrying them would burn the whole attempt budget on something
 *     that can never succeed.
 */

const DELIVERY = "88888888-8888-4888-8888-888888888888";
const NOTIFICATION = "55555555-5555-4555-8555-555555555555";
const BOB = "22222222-2222-4222-8222-222222222222";

const delivery = (overrides: Partial<NotificationDelivery> = {}): NotificationDelivery =>
  ({
    id: DELIVERY,
    notificationId: NOTIFICATION,
    userId: BOB,
    channel: NotificationChannel.PUSH,
    status: NotificationDeliveryStatus.PENDING,
    attemptCount: 0,
    maxAttempts: NOTIFICATION_DELIVERY_MAX_ATTEMPTS,
    nextAttemptAt: new Date(),
    lastError: null,
    providerMessageId: null,
    sentAt: null,
    ...overrides
  }) as NotificationDelivery;

const notification = (overrides: Partial<Notification> = {}): Notification =>
  ({
    id: NOTIFICATION,
    userId: BOB,
    type: "message",
    title: "Message from Alice",
    body: "leg day",
    data: { conversationId: "c1" },
    actionUrl: "/messages/c1",
    ...overrides
  }) as Partial<Notification> as Notification;

const prefs = (overrides: Partial<EffectivePreferences> = {}): EffectivePreferences => ({
  inAppEnabled: true,
  pushEnabled: true,
  emailEnabled: true,
  mutedTypes: [],
  deviceTokens: ["device-1"],
  ...overrides
});

const makeProcessor = (
  options: { row?: NotificationDelivery | null; row2?: NotificationDelivery | null; notification?: Notification | null; preferences?: EffectivePreferences } = {}
) => {
  const row = "row" in options ? (options.row ?? null) : delivery();
  const row2 = "row2" in options ? (options.row2 ?? null) : row;
  const notificationRow = "notification" in options ? (options.notification ?? null) : notification();
  const preferences = options.preferences ?? prefs();

  // What actually gets written to the ledger, so tests can read the exact row
  // the processor saved instead of reaching into `.mock.calls`.
  const savedRows: NotificationDelivery[] = [];

  const findDelivery = jest.fn<Promise<NotificationDelivery | null>, [string]>().mockResolvedValueOnce(row).mockResolvedValue(row2);
  const saveDelivery = jest.fn((d: NotificationDelivery): NotificationDelivery => {
    savedRows.push(d);
    return d;
  });
  const deliveriesRepo = { findOne: findDelivery, save: saveDelivery } as unknown as Repository<NotificationDelivery>;

  const findNotification = jest.fn<Promise<Notification | null>, [string]>().mockResolvedValue(notificationRow);
  const notificationsRepo = { findOne: findNotification } as unknown as Repository<Notification>;

  const findUser = jest.fn().mockResolvedValue({ id: BOB, email: "bob@example.com", name: "Bob" });
  const userRepo = { findOne: findUser } as unknown as Repository<User>;

  const resolvePreferences = jest.fn().mockResolvedValue(preferences);
  const notificationsService = { resolvePreferences } as unknown as NotificationsService;

  const pushSend = jest.fn().mockResolvedValue({ providerMessageId: "apns-1" });
  const pushProvider = { send: pushSend } as unknown as PushNotificationProvider;

  const emailSend = jest.fn().mockResolvedValue({ providerMessageId: "smtp-1" });
  const emailProvider = { send: emailSend } as unknown as EmailNotificationProvider;

  const processor = new NotificationDeliveryProcessor(deliveriesRepo, notificationsRepo, userRepo, notificationsService, pushProvider, emailProvider);
  return { processor, findDelivery, saveDelivery, savedRows, findNotification, findUser, resolvePreferences, pushSend, emailSend };
};

describe("NotificationDeliveryProcessor — a successful attempt", () => {
  it("sends, stamps the row SENT and records the provider's message id", async () => {
    const { processor, pushSend, saveDelivery, savedRows } = makeProcessor();

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "sent" });
    expect(pushSend).toHaveBeenCalledWith({
      token: "device-1",
      title: "Message from Alice",
      body: "leg day",
      // The client needs the id and the deep link to open the right thread.
      data: { conversationId: "c1", notificationId: NOTIFICATION, type: "message", actionUrl: "/messages/c1" }
    });
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.SENT, providerMessageId: "apns-1", attemptCount: 1 }));
    expect(savedRows[0].sentAt).toBeInstanceOf(Date);
  });

  it("never touches the push provider for an email delivery", async () => {
    const { processor, emailSend, pushSend, findUser } = makeProcessor({
      row: delivery({ channel: NotificationChannel.EMAIL })
    });

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "sent" });
    expect(findUser).toHaveBeenCalled();
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({ to: "bob@example.com", subject: "Message from Alice", text: "leg day" }));
    expect(pushSend).not.toHaveBeenCalled();
  });

  it("fans out over every registered device", async () => {
    const { processor, pushSend } = makeProcessor({ preferences: prefs({ deviceTokens: ["device-1", "device-2"] }) });

    await processor.attempt(DELIVERY);

    expect(pushSend).toHaveBeenCalledTimes(2);
  });
});

describe("NotificationDeliveryProcessor — retry behaviour", () => {
  it("keeps a failed attempt PENDING, records the error and pushes the backoff out", async () => {
    const { processor, saveDelivery, savedRows, pushSend } = makeProcessor();
    pushSend.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await processor.attempt(DELIVERY);

    // Retryable, not terminal: the job is re-run with a growing backoff and the
    // row stays pending so the ledger does not claim it failed.
    expect(result).toEqual({ outcome: "retryable_failure", error: "503 Service Unavailable" });
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.PENDING, attemptCount: 1, lastError: "503 Service Unavailable" }));
    expect(savedRows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("marks the row FAILED on the last permitted attempt", async () => {
    const { processor, saveDelivery, pushSend } = makeProcessor({
      row: delivery({ attemptCount: NOTIFICATION_DELIVERY_MAX_ATTEMPTS - 1 })
    });
    pushSend.mockRejectedValue(new Error("503 Service Unavailable"));

    const result = await processor.attempt(DELIVERY);

    // Exhaustion is explicit, so the failure is visible in the database rather
    // than vanishing with the job.
    expect(result).toEqual({ outcome: "exhausted", error: "503 Service Unavailable" });
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.FAILED, attemptCount: NOTIFICATION_DELIVERY_MAX_ATTEMPTS }));
  });

  it("grows the backoff with each attempt", async () => {
    const first = makeProcessor({ row: delivery({ attemptCount: 0 }) });
    first.pushSend.mockRejectedValue(new Error("timeout"));
    await first.processor.attempt(DELIVERY);
    const firstSaved = first.savedRows[0];

    const second = makeProcessor({ row: delivery({ attemptCount: 3 }) });
    second.pushSend.mockRejectedValue(new Error("timeout"));
    await second.processor.attempt(DELIVERY);
    const secondSaved = second.savedRows[0];

    expect(secondSaved.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(firstSaved.nextAttemptAt.getTime() - Date.now());
  });

  it("succeeds on a retry after transient failures, without a duplicate send", async () => {
    const { processor, pushSend, saveDelivery } = makeProcessor({ row: delivery({ attemptCount: 2, lastError: "503 Service Unavailable" }) });

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "sent" });
    expect(pushSend).toHaveBeenCalledTimes(1);
    // The stale error is cleared, so a later operator does not read a resolved
    // failure off the row.
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.SENT, lastError: null, attemptCount: 3 }));
  });

  it("treats one dead device as a success when another device accepted it", async () => {
    const { processor, pushSend, saveDelivery } = makeProcessor({ preferences: prefs({ deviceTokens: ["stale-token", "device-2"] }) });
    pushSend.mockRejectedValueOnce(new Error("410 Unregistered")).mockResolvedValueOnce({ providerMessageId: "apns-2" });

    const result = await processor.attempt(DELIVERY);

    // A single invalid token must not hide the notification on the user's other
    // device, so only a total failure is a failure.
    expect(result).toEqual({ outcome: "sent" });
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.SENT, providerMessageId: "apns-2" }));
  });

  it("fails only when every device failed", async () => {
    const { processor, pushSend } = makeProcessor({ preferences: prefs({ deviceTokens: ["stale-1", "stale-2"] }) });
    pushSend.mockRejectedValue(new Error("410 Unregistered"));

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "retryable_failure", error: "410 Unregistered" });
    expect(pushSend).toHaveBeenCalledTimes(2);
  });

  it("caps the recorded error so a provider's page of text cannot blow past the column", async () => {
    const { processor, savedRows, pushSend } = makeProcessor();
    pushSend.mockRejectedValue(new Error("x".repeat(5000)));

    await processor.attempt(DELIVERY);

    expect(savedRows[0].lastError).toHaveLength(2000);
  });
});

describe("NotificationDeliveryProcessor — terminal and skipped states", () => {
  /** A redelivered job after a lock loss must not double-send. */
  it("short-circuits an already-sent row without calling the provider again", async () => {
    const { processor, pushSend, saveDelivery } = makeProcessor({ row: delivery({ status: NotificationDeliveryStatus.SENT, sentAt: new Date() }) });

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "already_sent" });
    expect(pushSend).not.toHaveBeenCalled();
    expect(saveDelivery).not.toHaveBeenCalled();
  });

  it("reports a vanished delivery row rather than throwing", async () => {
    const { processor, pushSend } = makeProcessor({ row: null });

    expect(await processor.attempt(DELIVERY)).toEqual({ outcome: "missing" });
    expect(pushSend).not.toHaveBeenCalled();
  });

  it("skips when the notification row has been deleted since scheduling", async () => {
    const { processor, pushSend, saveDelivery } = makeProcessor({ notification: null });

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "missing" });
    expect(pushSend).not.toHaveBeenCalled();
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.SKIPPED, lastError: "Notification no longer exists" }));
  });

  it("skips a push the user opted out of after it was scheduled", async () => {
    // Retrying this would burn all five attempts re-sending something the user
    // explicitly declined.
    const { processor, pushSend, saveDelivery } = makeProcessor({ preferences: prefs({ pushEnabled: false }) });

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "skipped" });
    expect(pushSend).not.toHaveBeenCalled();
    expect(saveDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: NotificationDeliveryStatus.SKIPPED }));
  });

  it("skips an email the user opted out of after it was scheduled", async () => {
    const { processor, emailSend } = makeProcessor({ row: delivery({ channel: NotificationChannel.EMAIL }), preferences: prefs({ emailEnabled: false }) });

    expect(await processor.attempt(DELIVERY)).toEqual({ outcome: "skipped" });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("skips a push with no registered device", async () => {
    const { processor, pushSend } = makeProcessor({ preferences: prefs({ deviceTokens: [] }) });

    expect(await processor.attempt(DELIVERY)).toEqual({ outcome: "skipped" });
    expect(pushSend).not.toHaveBeenCalled();
  });

  it("re-reads preferences at send time rather than trusting the scheduling-time snapshot", async () => {
    const { processor, resolvePreferences, pushSend } = makeProcessor();

    await processor.attempt(DELIVERY);

    // The gap between scheduling and sending is where an opt-out happens.
    expect(resolvePreferences).toHaveBeenCalledWith(BOB);
    expect(pushSend).toHaveBeenCalled();
  });

  it("retries an email whose recipient has been deleted", async () => {
    // A user can be hard-deleted by an operator; the notification is retryable
    // because the row may come back, and the ledger records why it failed.
    const { processor, findUser, emailSend } = makeProcessor({ row: delivery({ channel: NotificationChannel.EMAIL }) });
    findUser.mockResolvedValue(null);

    const result = await processor.attempt(DELIVERY);

    expect(result).toEqual({ outcome: "retryable_failure", error: "Recipient no longer exists" });
    expect(emailSend).not.toHaveBeenCalled();
  });
});
