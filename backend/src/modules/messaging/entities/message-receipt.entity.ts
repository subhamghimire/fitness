import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * MESSAGE RECEIPT
 *
 * Per-recipient delivery and read state for a single message. This is the
 * fine-grained record behind "delivered" ticks in the UI; the participant's
 * `lastReadMessageId` high-water mark is the aggregate that keeps the unread
 * count O(1).
 *
 * `(message_id, user_id)` is unique, so marking the same message delivered or
 * read repeatedly — which happens constantly, because clients report state on
 * every foreground and on every reconnect — is an upsert rather than an
 * accumulation of duplicate rows.
 *
 * Infrastructure metadata, not a domain entity: receipts are an append-only
 * status log, so there are no soft-delete columns.
 */
@Entity("message_receipts")
@Index("uk_message_receipts_message_user", ["messageId", "userId"], { unique: true })
@Index("idx_message_receipts_user", ["userId", "createdAt"])
export class MessageReceipt {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "message_id", type: "uuid" })
  messageId: string;

  @Column({ name: "conversation_id", type: "uuid" })
  conversationId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "delivered_at", type: "timestamptz", nullable: true })
  deliveredAt: Date | null;

  @Column({ name: "read_at", type: "timestamptz", nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz", default: () => "NOW()" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz", default: () => "NOW()" })
  updatedAt: Date;
}
