import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { ConversationParticipantRole, MessageDeliveryState } from "../enums";
import { Conversation } from "./conversation.entity";

/**
 * CONVERSATION PARTICIPANT
 *
 * Membership is the authorisation boundary for the whole module: every read,
 * every write and every WebSocket frame is gated on an active row here. That is
 * why the unique index is *partial* (`left_at IS NULL`) — a user who leaves and
 * is re-invited gets a fresh row, while still being unable to hold two active
 * memberships in the same conversation.
 *
 * Read state is stored as a high-water mark (`lastReadMessageId` /
 * `lastReadAt`) rather than a per-message flag, because the client always reads
 * a conversation in order: "everything up to X is read" is both the truth and
 * an O(1) unread count. The per-message `MessageReceipt` rows are the fine-grained
 * audit written by the same operation.
 *
 * `lastDeliveredMessageId` is the same idea for delivery state: it lets a client
 * tell the sender "your messages are on my device" without the sender querying
 * every message.
 */
@Entity("conversation_participants")
@Index("idx_conversation_participants_user_active", ["userId", "leftAt"])
@Index("idx_conversation_participants_conversation_active", ["conversationId", "leftAt"])
@Index("uk_conversation_participants_active", ["conversationId", "userId"], { unique: true, where: '"left_at" IS NULL' })
export class ConversationParticipant extends AbstractEntity {
  @Column({ name: "conversation_id", type: "uuid" })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation: Conversation;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ type: "varchar", length: 16, default: ConversationParticipantRole.MEMBER })
  role: ConversationParticipantRole;

  @Column({ name: "last_read_message_id", type: "uuid", nullable: true })
  lastReadMessageId: string | null;

  @Column({ name: "last_read_at", type: "timestamptz", nullable: true })
  lastReadAt: Date | null;

  @Column({ name: "last_delivered_message_id", type: "uuid", nullable: true })
  lastDeliveredMessageId: string | null;

  @Column({ name: "last_delivered_at", type: "timestamptz", nullable: true })
  lastDeliveredAt: Date | null;

  /** Muted participants keep receiving messages but generate no notifications. */
  @Column({ name: "is_muted", type: "boolean", default: false })
  isMuted: boolean;

  @Column({ name: "joined_at", type: "timestamptz", default: () => "NOW()" })
  joinedAt: Date;

  /** Set on leave/remove. NULL means active membership. */
  @Column({ name: "left_at", type: "timestamptz", nullable: true })
  leftAt: Date | null;

  /** Denormalised for the inbox list; recomputed on send/read. */
  @Column({ name: "unread_count", type: "int", default: 0 })
  unreadCount: number;

  /** Aggregate read state of the conversation from this participant's view. */
  @Column({ name: "read_state", type: "varchar", length: 16, default: MessageDeliveryState.SENT })
  readState: MessageDeliveryState;
}
