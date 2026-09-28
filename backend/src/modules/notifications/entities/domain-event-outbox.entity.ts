import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { DomainAggregateType, DomainEventType, NotificationAudience } from "src/common/events";
import { JsonObject } from "src/common/json";
import { DomainEventOutboxStatus } from "../enums";

export const DOMAIN_EVENT_OUTBOX_MAX_RELAY_ATTEMPTS = 8;

/**
 * TRANSACTIONAL OUTBOX
 *
 * One row per domain event occurrence, written inside the producing
 * transaction (see `DomainEventPublisher.publishInTransaction`). This is what
 * makes the guarantee "a failed notification cannot fail the workout
 * transaction" true by construction:
 *
 *   - the producer performs a single INSERT on its own connection — no provider
 *     I/O, so there is nothing notification-related that can abort the workout;
 *   - the row is committed atomically with the workout, so a crash between
 *     "workout saved" and "event announced" is impossible;
 *   - a rollback discards the event too, so no phantom notification is possible.
 *
 * Like `sync_changes` and `progress_workout_queue`, this is infrastructure
 * metadata and deliberately does NOT extend AbstractEntity: a domain event is
 * immutable, so it has no soft-delete columns and no updated-at semantics.
 *
 * `idempotencyKey` is uniquely indexed. Re-publishing the same occurrence — an
 * offline sync replay, a projection reprojection, a retried relay — is an
 * `ON CONFLICT DO NOTHING` insert, so the outbox can never contain two rows for
 * one occurrence. That is the first of the two dedupe layers (the second is the
 * unique `(user_id, dedupe_key)` on `notifications`).
 */
@Entity("domain_event_outbox")
@Index("idx_outbox_status_next_attempt", ["status", "nextAttemptAt"])
@Index("idx_outbox_aggregate", ["aggregateType", "aggregateId"])
export class DomainEventOutbox {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "event_type", type: "varchar", length: 60 })
  eventType: DomainEventType;

  @Column({ name: "aggregate_type", type: "varchar", length: 40 })
  aggregateType: DomainAggregateType;

  @Column({ name: "aggregate_id", type: "uuid" })
  aggregateId: string;

  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @Column({ name: "audience", type: "jsonb" })
  audience: NotificationAudience;

  /**
   * The event payload, as written by the producer. Typed as a plain JSON object
   * rather than the `DomainEventPayloadMap` union: the row is rehydrated into a
   * `DomainEvent` by `NotificationEventHandler`, which is the one place allowed
   * to assert that the stored JSON matches the event it was written for.
   */
  @Column({ type: "jsonb" })
  payload: JsonObject;

  @Index("uk_outbox_idempotency_key", { unique: true })
  @Column({ name: "idempotency_key", type: "varchar", length: 240 })
  idempotencyKey: string;

  @Column({ type: "varchar", length: 16, default: DomainEventOutboxStatus.PENDING })
  status: DomainEventOutboxStatus;

  @Column({ name: "attempt_count", type: "int", default: 0 })
  attemptCount: number;

  @Column({ name: "next_attempt_at", type: "timestamptz", default: () => "NOW()" })
  nextAttemptAt: Date;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  /** Set when the row was handed to the background job queue. */
  @Column({ name: "dispatched_at", type: "timestamptz", nullable: true })
  dispatchedAt: Date | null;

  /**
   * Set when the job finished materialising notifications. Written *after* the
   * work succeeds, so a crashed/retried job re-runs — which is safe precisely
   * because materialisation is dedupe-guarded by `notifications.dedupeKey`.
   */
  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "NOW()" })
  updatedAt: Date;
}
