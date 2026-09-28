import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DomainEventPublisher } from "src/common/events";
import { AuthModule } from "src/modules/auth/auth.module";
import { CoachClientRelationship } from "src/modules/coach-client/entities/coach-client-relationship.entity";
import { ConversationParticipant } from "src/modules/messaging/entities/conversation-participant.entity";
import { User } from "src/modules/users/entities/user.entity";
import { RedisModule } from "src/shared/redis";
import { DomainEventOutbox, Notification, NotificationDelivery, NotificationPreference } from "./entities";
import { NotificationAudienceResolver } from "./notification-audience.resolver";
import { NotificationDeliveryProcessor } from "./notification-delivery.processor";
import { NotificationDeliveryWorker } from "./notification-delivery.worker";
import { NotificationEventHandler } from "./notification-event.handler";
import { NotificationEventWorker } from "./notification-event.worker";
import { NotificationOutboxRelay } from "./notification-outbox.relay";
import { NotificationQueueService } from "./notification-queue.service";
import { NotificationRenderer } from "./notification-renderer";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { OutboxDomainEventPublisher } from "./outbox-domain-event.publisher";
import { LoggingEmailNotificationProvider, LoggingPushNotificationProvider } from "./providers/logging-notification.providers";
import { EmailNotificationProvider, PushNotificationProvider } from "./providers/notification-provider";

/**
 * NOTIFICATIONS MODULE
 * ---------------------------------------------------------------------------
 * Implements the pipeline
 *
 *   Domain Event → Event Handler → Background Job → Notification Provider
 *
 * as four separately testable units plus two durable stores:
 *
 *   1. DOMAIN EVENT        `OutboxDomainEventPublisher` writes a
 *                          `domain_event_outbox` row *inside the producer's
 *                          transaction*. Exported as `DomainEventPublisher`, so
 *                          no producer imports a notification, a channel or a
 *                          provider. This is the mechanism that makes "a failed
 *                          notification cannot fail the workout transaction"
 *                          true: the only thing in the business transaction is
 *                          one INSERT on the same connection.
 *   2. EVENT HANDLER       `NotificationEventHandler` resolves the audience,
 *                          applies preferences, renders copy and materialises
 *                          deduplicated in-app `notifications` rows.
 *   3. BACKGROUND JOB      `NotificationOutboxRelay` hands events to BullMQ;
 *                          `NotificationEventWorker` and
 *                          `NotificationDeliveryWorker` consume the two
 *                          queues. Retries are BullMQ's `attempts` + backoff.
 *   4. PROVIDER            `PushNotificationProvider` /
 *                          `EmailNotificationProvider` abstractions, with
 *                          logging defaults swapped for FCM/SES by overriding
 *                          two providers here and nothing else.
 *
 * The outbox is a stage-1 *record*, not the job queue. Keeping it in Postgres
 * (rather than writing straight to Redis) is what buys atomicity with the
 * business transaction; BullMQ then owns execution and retries. Each row is
 * dedupe-guarded by a unique `idempotency_key`, and each notification by a
 * unique `(user_id, dedupe_key)`, so a replayed event cannot fan out twice.
 *
 * `CoachClientRelationship` and `ConversationParticipant` are registered as
 * read-only repos purely so the audience resolver can expand an audience. No
 * coach-client or messaging service is imported, so the dependency graph stays
 * acyclic (both of those modules depend on *this* one for the publisher).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DomainEventOutbox, Notification, NotificationPreference, NotificationDelivery, User, CoachClientRelationship, ConversationParticipant]),
    ConfigModule,
    AuthModule,
    RedisModule
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRenderer,
    NotificationAudienceResolver,
    NotificationEventHandler,
    NotificationDeliveryProcessor,
    NotificationQueueService,
    NotificationOutboxRelay,
    NotificationEventWorker,
    NotificationDeliveryWorker,
    { provide: DomainEventPublisher, useClass: OutboxDomainEventPublisher },
    // Swap these two for FCM/APNs + SES/Postmark implementations; nothing else
    // in the pipeline changes.
    { provide: PushNotificationProvider, useClass: LoggingPushNotificationProvider },
    { provide: EmailNotificationProvider, useClass: LoggingEmailNotificationProvider }
  ],
  exports: [DomainEventPublisher, NotificationsService, NotificationRenderer]
})
export class NotificationsModule {}
