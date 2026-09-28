import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { DomainEvent, DomainEventPublisher } from "src/common/events";
import { JsonObject } from "src/common/json";
import { DomainEventOutbox } from "./entities";
import { DomainEventOutboxStatus } from "./enums";

/**
 * OUTBOX-BACKED DOMAIN EVENT PUBLISHER
 *
 * The concrete `DomainEventPublisher`. Every producer in the codebase
 * (`WorkoutService`, `ProgressProjectionService`, `ProgramAssignmentService`,
 * `CoachClientRelationshipService`, `MessagingService`) reaches the pipeline
 * through this one class.
 *
 * The write is a single `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`
 * against the caller's `EntityManager` when one is supplied. Consequences:
 *
 *   - It is part of the caller's transaction, so a committed workout always has
 *     its event and a rolled-back workout never leaves one behind.
 *   - It performs no provider I/O, so "a notification failed" cannot be a reason
 *     the workout write fails. That is the whole reason the outbox exists
 *     instead of calling an event bus inline.
 *   - Re-publishing the same occurrence is a no-op, so an offline sync replay
 *     or a projection reprojection cannot fan out into a second notification.
 *
 * The standalone `publish()` path is for producers that are not inside a
 * transaction. It uses the DataSource's own manager and **swallows** failures:
 * a coach invitation must not fail with a 500 because the notification
 * outbox was briefly unavailable.
 */
@Injectable()
export class OutboxDomainEventPublisher extends DomainEventPublisher {
  private readonly logger = new Logger(OutboxDomainEventPublisher.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async publishInTransaction(manager: EntityManager, event: DomainEvent): Promise<void> {
    await this.insert(manager, event);
  }

  async publish(event: DomainEvent): Promise<void> {
    try {
      await this.insert(this.dataSource.manager, event);
    } catch (error) {
      // Intentionally swallowed: the business write already succeeded. The
      // event is lost rather than retried here, but a *recoverable* failure
      // surface would require a second outbox, and the producers that matter
      // most (workout, progress) use the transactional path where nothing is
      // ever lost.
      this.logger.error(
        `Failed to record domain event "${event.idempotencyKey}" — the business write succeeded and the notification was dropped`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  private async insert(manager: EntityManager, event: DomainEvent): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(DomainEventOutbox)
      .values({
        eventType: event.type,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        actorId: event.actorId,
        audience: event.audience,
        // The payload is a discriminated union of concrete payload interfaces,
        // which structurally are JSON objects; the cast tells TypeORM the same
        // thing for the jsonb column.
        payload: event.payload as unknown as JsonObject,
        idempotencyKey: event.idempotencyKey,
        status: DomainEventOutboxStatus.PENDING,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        dispatchedAt: null,
        processedAt: null
      })
      .orIgnore()
      .execute();
  }
}
