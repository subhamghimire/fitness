import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { JsonObject } from "src/common/json";
import { User } from "src/modules/users/entities/user.entity";
import { MessageType } from "../enums";
import { Conversation } from "./conversation.entity";

/**
 * MESSAGE
 *
 * `(conversation_id, sender_id, client_message_id)` is unique and is the
 * idempotency key for sending. Mobile clients generate `clientMessageId`
 * themselves, so a send retried over a flaky connection — or delivered twice
 * because the client raced two sockets — resolves to the same row instead of
 * posting the message twice. The API returns the existing message with
 * `duplicate: true` so a client can reconcile its optimistic UI.
 *
 * `body` is nullable because an image message carries only `metadata`; the
 * CHECK constraint in the migration keeps at least one of the two populated.
 */
@Entity("messages")
@Index("idx_messages_conversation_created", ["conversationId", "createdAt"])
@Index("idx_messages_sender_created", ["senderId", "createdAt"])
@Index("uk_messages_client_id", ["conversationId", "senderId", "clientMessageId"], { unique: true })
export class Message extends AbstractEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation: Conversation;

  @Column({ name: "sender_id", type: "uuid" })
  senderId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sender_id" })
  sender: User;

  @Column({ type: "varchar", length: 16, default: MessageType.TEXT })
  type: MessageType;

  @Column({ type: "text", nullable: true })
  body: string | null;

  @Column({ name: "reply_to_id", type: "uuid", nullable: true })
  replyToId: string | null;

  /** Client-generated UUID; the dedupe key for a retried send. */
  @Column({ name: "client_message_id", type: "varchar", length: 100 })
  clientMessageId: string;

  /** Channel-agnostic attachment descriptors (url, mime, size, …). */
  @Column({ type: "jsonb", nullable: true })
  metadata: JsonObject | null;

  @Column({ name: "edited_at", type: "timestamptz", nullable: true })
  editedAt: Date | null;
}
