import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { Notification, NotificationDelivery } from "./entities";
import { NotificationChannel, NotificationDeliveryStatus } from "./enums";
import { EmailNotificationProvider, PushNotificationProvider } from "./providers/notification-provider";
import { NotificationsService } from "./notifications.service";

export type DeliveryOutcome = "sent" | "skipped" | "retryable_failure" | "exhausted" | "already_sent" | "missing";

/**
 * NOTIFICATION DELIVERY PROCESSOR  (pipeline stages 3 + 4)
 * ---------------------------------------------------------------------------
 * Background Job ──▶ **this** ──▶ Notification Provider
 *
 * Performs exactly one delivery attempt for a push or email and records the
 * outcome in the delivery ledger. Like the event handler it is a plain
 * injectable with no queue dependency, so the retry policy can be tested without
 * Redis: the BullMQ worker simply calls `attempt()` and rethrows on
 * `retryable_failure` so BullMQ's own `attempts` + exponential backoff drives the
 * retry.
 *
 * Retry semantics, and why they are shaped this way:
 *
 *   - A provider rejection is **retryable**: transient 5xx, rate limits and
 *     network faults must not lose a push. The ledger keeps the row `PENDING`,
 *     records the error and lets the job be retried with a growing backoff.
 *   - Opting out between scheduling and delivery is **skipped**, not an error.
 *     Throwing here would burn all five attempts re-sending something the user
 *     explicitly declined.
 *   - A push with no device token is likewise **skipped**.
 *   - Success is terminal. `SENT` rows short-circuit, so a duplicated job (a
 *     redelivery after a lock loss) can never send the same notification twice.
 *   - Exhaustion is explicit: the last failing attempt marks the row `FAILED`
 *     with the final error, so the failure is visible in the database rather
 *     than silently vanishing with the job.
 */
@Injectable()
export class NotificationDeliveryProcessor {
  private readonly logger = new Logger(NotificationDeliveryProcessor.name);

  constructor(
    @InjectRepository(NotificationDelivery) private readonly deliveriesRepo: Repository<NotificationDelivery>,
    @InjectRepository(Notification) private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly pushProvider: PushNotificationProvider,
    private readonly emailProvider: EmailNotificationProvider
  ) {}

  async attempt(deliveryId: string): Promise<{ outcome: DeliveryOutcome; error?: string }> {
    const delivery = await this.deliveriesRepo.findOne({ where: { id: deliveryId } });
    if (!delivery) return { outcome: "missing" };
    if (delivery.status === NotificationDeliveryStatus.SENT) return { outcome: "already_sent" };

    const notification = await this.notificationsRepo.findOne({ where: { id: delivery.notificationId } });
    if (!notification) {
      await this.finish(delivery, NotificationDeliveryStatus.SKIPPED, { error: "Notification no longer exists" });
      return { outcome: "missing" };
    }

    // Re-read preferences at send time: the user may have opted out between the
    // event being handled and this job running.
    const preferences = await this.notificationsService.resolvePreferences(delivery.userId);
    if (this.isDisabled(delivery.channel, preferences)) {
      await this.finish(delivery, NotificationDeliveryStatus.SKIPPED);
      return { outcome: "skipped" };
    }
    if (delivery.channel === NotificationChannel.PUSH && preferences.deviceTokens.length === 0) {
      await this.finish(delivery, NotificationDeliveryStatus.SKIPPED);
      return { outcome: "skipped" };
    }

    const attemptNumber = delivery.attemptCount + 1;
    try {
      const result =
        delivery.channel === NotificationChannel.PUSH ? await this.sendPush(delivery, notification, preferences.deviceTokens) : await this.sendEmail(delivery, notification);

      await this.finish(delivery, NotificationDeliveryStatus.SENT, { providerMessageId: result.providerMessageId ?? null, attemptNumber });
      return { outcome: "sent" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attemptNumber >= delivery.maxAttempts;
      await this.finish(delivery, exhausted ? NotificationDeliveryStatus.FAILED : NotificationDeliveryStatus.PENDING, { error: message, attemptNumber });
      this.logger.warn(`Notification delivery failed (delivery=${delivery.id}, channel=${delivery.channel}, attempt=${attemptNumber}/${delivery.maxAttempts}): ${message}`);
      return { outcome: exhausted ? "exhausted" : "retryable_failure", error: message };
    }
  }

  /** One device succeeding is enough; only a total failure is a failure. */
  private async sendPush(delivery: NotificationDelivery, notification: Notification, deviceTokens: string[]) {
    let providerMessageId: string | undefined;
    let lastError: Error | undefined;

    // Fan out over every registered device. One dead token must not hide the
    // notification on the user's other devices, so failures are collected and
    // the send only "fails" if every device failed.
    for (const token of deviceTokens) {
      try {
        const result = await this.pushProvider.send({
          token,
          title: notification.title,
          body: notification.body,
          data: { ...(notification.data ?? {}), notificationId: notification.id, type: notification.type, actionUrl: notification.actionUrl }
        });
        providerMessageId = result.providerMessageId ?? providerMessageId;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    if (providerMessageId === undefined && lastError) throw lastError;
    return { providerMessageId };
  }

  private async sendEmail(delivery: NotificationDelivery, notification: Notification) {
    const user = await this.userRepo.findOne({ where: { id: delivery.userId }, select: { id: true, email: true, name: true } });
    if (!user) throw new Error("Recipient no longer exists");

    const result = await this.emailProvider.send({
      to: user.email,
      subject: notification.title,
      text: notification.body,
      data: { notificationId: notification.id, actionUrl: notification.actionUrl }
    });
    return { providerMessageId: result.providerMessageId };
  }

  private isDisabled(channel: NotificationChannel, preferences: { pushEnabled: boolean; emailEnabled: boolean }): boolean {
    if (channel === NotificationChannel.PUSH) return !preferences.pushEnabled;
    if (channel === NotificationChannel.EMAIL) return !preferences.emailEnabled;
    return false;
  }

  private async finish(
    delivery: NotificationDelivery,
    status: NotificationDeliveryStatus,
    opts: { error?: string; providerMessageId?: string | null; attemptNumber?: number } = {}
  ): Promise<void> {
    delivery.status = status;
    delivery.lastError = opts.error ? opts.error.slice(0, 2000) : null;
    delivery.providerMessageId = opts.providerMessageId ?? delivery.providerMessageId;
    if (status === NotificationDeliveryStatus.SENT) delivery.sentAt = new Date();
    if (opts.attemptNumber !== undefined) delivery.attemptCount = opts.attemptNumber;
    if (status === NotificationDeliveryStatus.PENDING) {
      // Mirrors the queue's exponential backoff so the ledger tells the same
      // story as the job scheduler.
      const backoffMs = Math.min(2000 * 2 ** Math.max(0, delivery.attemptCount - 1), 300000);
      delivery.nextAttemptAt = new Date(Date.now() + backoffMs);
    }
    await this.deliveriesRepo.save(delivery);
  }
}
