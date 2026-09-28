import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { NotificationChannel, NotificationDeliveryStatus } from "../enums";

export const NOTIFICATION_DELIVERY_MAX_ATTEMPTS = 5;

/**
 * PUSH / EMAIL DELIVERY LEDGER
 *
 * One row per (notification, provider-backed channel). The in-app channel is
 * deliberately absent: the `notifications` row is the in-app delivery, so
 * recording a second "sent" row for it would be a duplicate source of truth.
 *
 * This table is what makes retries *observable* rather than invisible inside
 * Redis: `attemptCount`, `nextAttemptAt` and `lastError` show exactly how far a
 * delivery got and why it stopped, and the unique `(notification_id, channel)`
 * index means a retried job can never push or email the same notification twice
 * on the same channel.
 *
 * Infrastructure metadata, not a domain entity — no soft-delete columns.
 */
@Entity("notification_deliveries")
@Index("uk_notification_deliveries_notification_channel", ["notificationId", "channel"], { unique: true })
@Index("idx_notification_deliveries_status_next_attempt", ["status", "nextAttemptAt"])
export class NotificationDelivery {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "notification_id", type: "uuid" })
  notificationId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 16 })
  channel: NotificationChannel;

  @Column({ type: "varchar", length: 16, default: NotificationDeliveryStatus.PENDING })
  status: NotificationDeliveryStatus;

  @Column({ name: "attempt_count", type: "int", default: 0 })
  attemptCount: number;

  @Column({ name: "max_attempts", type: "int", default: NOTIFICATION_DELIVERY_MAX_ATTEMPTS })
  maxAttempts: number;

  /** Backoff target; the queue only becomes eligible once now >= this. */
  @Column({ name: "next_attempt_at", type: "timestamptz", default: () => "NOW()" })
  nextAttemptAt: Date;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @Column({ name: "provider_message_id", type: "varchar", length: 200, nullable: true })
  providerMessageId: string | null;

  @Column({ name: "sent_at", type: "timestamptz", nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "NOW()" })
  updatedAt: Date;
}
