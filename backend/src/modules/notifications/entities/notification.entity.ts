import { Column, Entity, Index } from "typeorm";
import { AbstractEntity } from "src/entities";
import { JsonObject } from "src/common/json";
import { NotificationType } from "../enums";

/**
 * IN-APP NOTIFICATION
 *
 * A row in this table *is* the in-app delivery: it is created by the event
 * handler running in a background job, so the client's in-app inbox is already
 * populated by the time the API is polled. Push and email are separate,
 * provider-backed deliveries tracked in `notification_deliveries`.
 *
 * `(user_id, dedupe_key)` is unique and is the second dedupe layer. `dedupeKey`
 * is derived from the event's `idempotencyKey` plus the recipient, so a retried
 * job, a double-published event or two relay instances racing all collapse into
 * a single notification via `ON CONFLICT DO NOTHING`.
 *
 * Notifications are never soft-deleted (they are a user-facing history), so the
 * unique key is not reclaimed by a tombstone the way it would be on a domain
 * entity.
 */
@Entity("notifications")
@Index("idx_notifications_user_created", ["userId", "createdAt"])
// Partial: the unread badge and the `unreadOnly` list always read
// `read_at IS NULL`, so indexing only those rows keeps the index proportional to
// the unread set rather than to a history that only grows.
@Index("idx_notifications_user_unread", ["userId", "readAt"], { where: '"read_at" IS NULL' })
@Index("uk_notifications_user_dedupe_key", ["userId", "dedupeKey"], { unique: true })
export class Notification extends AbstractEntity {
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 40 })
  type: NotificationType;

  @Column({ type: "varchar", length: 200 })
  title: string;

  @Column({ type: "text" })
  body: string;

  /** Structured payload for the client (deep link, avatar, entity refs). */
  @Column({ type: "jsonb", nullable: true })
  data: JsonObject | null;

  /** The user who triggered the notification, when there was one. */
  @Column({ name: "actor_id", type: "uuid", nullable: true })
  actorId: string | null;

  @Column({ name: "source_type", type: "varchar", length: 40, nullable: true })
  sourceType: string | null;

  @Column({ name: "source_id", type: "uuid", nullable: true })
  sourceId: string | null;

  @Column({ name: "dedupe_key", type: "varchar", length: 240 })
  dedupeKey: string;

  /** NULL means unread — the unread badge is a partial index over this. */
  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt: Date | null;

  @Column({ name: "action_url", type: "varchar", length: 500, nullable: true })
  actionUrl: string | null;
}
