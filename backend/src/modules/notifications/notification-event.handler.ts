import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DomainEvent } from "src/common/events";
import { DomainEventOutbox } from "./entities";
import { DomainEventOutboxStatus, NotificationChannel, PROVIDER_CHANNELS } from "./enums";
import { NOTIFICATION_DELIVERY_MAX_ATTEMPTS } from "./entities/notification-delivery.entity";
import { NotificationAudienceResolver } from "./notification-audience.resolver";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationRenderer } from "./notification-renderer";
import { NotificationsService } from "./notifications.service";

export interface HandleEventResult {
  status: "processed" | "duplicate" | "skipped";
  eventType: string;
  recipients: number;
  notificationsCreated: number;
  duplicatesSkipped: number;
  deliveriesScheduled: number;
}

/**
 * NOTIFICATION EVENT HANDLER  (pipeline stage 2)
 * ---------------------------------------------------------------------------
 * Domain Event ──▶ **this** ──▶ Background Job ──▶ Notification Provider
 *
 * Consumes one outbox row and turns it into user-visible notifications. It is
 * deliberately free of BullMQ: the queue worker is a three-line adapter around
 * `handle()`, which keeps the interesting logic (audience resolution,
 * preference filtering, deduplication, scheduling) unit-testable with no Redis
 * running at all.
 *
 * Guarantees:
 *
 *   - NO PROVIDER I/O. Push and email are only *scheduled* here; they are sent
 *     by the delivery job. So a slow or broken provider cannot stall event
 *     handling, and this stage can never fail because of a provider.
 *   - IDEMPOTENT. Materialisation is guarded by the unique
 *     `(userId, dedupeKey)` index, so handling the same outbox row twice (a
 *     BullMQ retry, two workers, a relay that re-dispatched) creates nothing new.
 *   - SELF-HEALING ON SCHEDULING. Delivery jobs are enqueued whether or not the
 *     notification row was newly created. If a previous attempt inserted the
 *     notification and then died before scheduling push, this run repairs it —
 *     `createDelivery` is itself dedupe-guarded, so nothing is double-sent.
 *   - PREFERENCES ARE HONOURED AT SEND TIME too, not only here, because a user
 *     may opt out between scheduling and delivery.
 */
@Injectable()
export class NotificationEventHandler {
  private readonly logger = new Logger(NotificationEventHandler.name);

  constructor(
    @InjectRepository(DomainEventOutbox) private readonly outboxRepo: Repository<DomainEventOutbox>,
    private readonly audienceResolver: NotificationAudienceResolver,
    private readonly renderer: NotificationRenderer,
    private readonly notificationsService: NotificationsService,
    private readonly queueService: NotificationQueueService
  ) {}

  async handle(outboxId: string): Promise<HandleEventResult> {
    const outbox = await this.outboxRepo.findOne({ where: { id: outboxId } });
    if (!outbox) {
      this.logger.warn(`Outbox row ${outboxId} no longer exists; nothing to handle`);
      return { status: "skipped", eventType: "unknown", recipients: 0, notificationsCreated: 0, duplicatesSkipped: 0, deliveriesScheduled: 0 };
    }

    const event = this.toEvent(outbox);
    const rendered = await this.renderer.render(event);

    const recipientIds = await this.audienceResolver.resolve(outbox.audience, outbox.actorId);
    if (recipientIds.length === 0) {
      await this.markProcessed(outbox.id);
      return { status: "processed", eventType: event.type, recipients: 0, notificationsCreated: 0, duplicatesSkipped: 0, deliveriesScheduled: 0 };
    }

    let notificationsCreated = 0;
    let duplicatesSkipped = 0;
    let deliveriesScheduled = 0;

    for (const recipientId of recipientIds) {
      const preferences = await this.notificationsService.resolvePreferences(recipientId);

      // A muted kind silences every channel for that recipient. This is the
      // single gate: the in-app row is not created either, so a muted kind never
      // re-appears once the user un-mutes.
      if (preferences.mutedTypes.includes(rendered.type)) continue;

      const { notification, created } = await this.notificationsService.createFromEvent({
        userId: recipientId,
        type: rendered.type,
        title: rendered.title,
        body: rendered.body,
        data: rendered.data,
        actorId: outbox.actorId,
        sourceType: outbox.aggregateType,
        sourceId: outbox.aggregateId,
        actionUrl: rendered.actionUrl,
        dedupeKey: `${outbox.idempotencyKey}:${recipientId}`
      });

      if (created) notificationsCreated++;
      else duplicatesSkipped++;

      deliveriesScheduled += await this.scheduleDeliveries(notification, preferences);
    }

    await this.markProcessed(outbox.id);

    return {
      status: notificationsCreated > 0 ? "processed" : duplicatesSkipped > 0 ? "duplicate" : "processed",
      eventType: event.type,
      recipients: recipientIds.length,
      notificationsCreated,
      duplicatesSkipped,
      deliveriesScheduled
    };
  }

  private async scheduleDeliveries(
    notification: { id: string; userId: string },
    preferences: { pushEnabled: boolean; emailEnabled: boolean; deviceTokens: string[] }
  ): Promise<number> {
    let scheduled = 0;
    for (const channel of PROVIDER_CHANNELS) {
      if (channel === NotificationChannel.PUSH && !preferences.pushEnabled) continue;
      if (channel === NotificationChannel.EMAIL && !preferences.emailEnabled) continue;
      // A push with no registered device is not a failure — it is simply not
      // deliverable, so no job is created and the ledger stays clean.
      if (channel === NotificationChannel.PUSH && preferences.deviceTokens.length === 0) continue;

      const delivery = await this.notificationsService.createDelivery(notification.id, notification.userId, channel, NOTIFICATION_DELIVERY_MAX_ATTEMPTS);
      if (!delivery) continue;
      await this.queueService.enqueueDelivery({ deliveryId: delivery.id, notificationId: notification.id, channel });
      scheduled++;
    }
    return scheduled;
  }

  /**
   * Rehydrates a persisted outbox row back into the typed event it was written
   * from. The `as unknown` hop is the honest acknowledgement that jsonb gives
   * back untyped JSON: the pairing of `eventType` ↔ `payload` is an invariant of
   * `OutboxDomainEventPublisher` (the only writer), not something Postgres can
   * enforce. A malformed row surfaces as an unhandled `switch` case, i.e. a loud
   * failure in the background job rather than a silently empty notification.
   */
  private toEvent(outbox: DomainEventOutbox): DomainEvent {
    return {
      type: outbox.eventType,
      occurredAt: outbox.createdAt,
      idempotencyKey: outbox.idempotencyKey,
      actorId: outbox.actorId,
      audience: outbox.audience,
      aggregate: { type: outbox.aggregateType, id: outbox.aggregateId },
      payload: outbox.payload
    } as unknown as DomainEvent;
  }

  private async markProcessed(outboxId: string): Promise<void> {
    await this.outboxRepo.update({ id: outboxId, status: DomainEventOutboxStatus.DISPATCHED }, { processedAt: new Date(), lastError: null });
  }
}
