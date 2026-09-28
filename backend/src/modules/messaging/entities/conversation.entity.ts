import { Column, Entity, Index, ManyToOne, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { ConversationType } from "../enums";

/**
 * CONVERSATION
 *
 * A thread of messages between two or more participants. Two shapes, decided at
 * creation time by the `type` column:
 *
 *   DIRECT — exactly two participants, no title, and a `direct_key` unique
 *            index. The key is the ordered, delimiter-joined participant pair,
 *            so a second direct thread between the same two people can never be
 *            created, no matter how many API calls race.
 *   GROUP  — 2..N participants with an owner/admin hierarchy and a title.
 *
 * `lastMessageId` / `lastMessageAt` / `lastMessagePreview` are a denormalised
 * conversation-list projection. The inbox is the hottest read in the module and
 * must not scan the message table to render a preview.
 */
@Entity("conversations")
@Index("idx_conversations_last_message", ["lastMessageAt"])
export class Conversation extends AbstractEntity {
  @Column({ type: "varchar", length: 16, default: ConversationType.DIRECT })
  type: ConversationType;

  @Column({ type: "varchar", length: 200, nullable: true })
  title: string | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "created_by_id" })
  createdBy: User;

  @Column({ name: "last_message_id", type: "uuid", nullable: true })
  lastMessageId: string | null;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt: Date | null;

  @Column({ name: "last_message_preview", type: "varchar", length: 300, nullable: true })
  lastMessagePreview: string | null;

  /**
   * Ordered participant pair for DIRECT threads, e.g. `a…uuid|b…uuid`.
   * NULL for GROUP conversations (no such invariant). The unique index is
   * partial so group rows do not all collide on NULL semantics.
   */
  @Index("uk_conversations_direct_key", { unique: true, where: '"direct_key" IS NOT NULL' })
  @Column({ name: "direct_key", type: "varchar", length: 200, nullable: true })
  directKey: string | null;
}
