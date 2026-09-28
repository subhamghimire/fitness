import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ConversationParticipantRole, ConversationType, MessageDeliveryState, MessageType } from "../enums";

export class ConversationParticipantResponseDto {
  @ApiProperty()
  userId: string;

  @ApiPropertyOptional({ nullable: true, description: "Display name, when the participant could be resolved" })
  name: string | null;

  @ApiPropertyOptional({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: ConversationParticipantRole })
  role: ConversationParticipantRole;

  @ApiProperty({ description: "Messages this participant has not read" })
  unreadCount: number;

  @ApiPropertyOptional({ nullable: true })
  lastReadAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastDeliveredAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  joinedAt: Date | null;

  @ApiProperty()
  isMuted: boolean;
}

export class ConversationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ConversationType })
  type: ConversationType;

  @ApiPropertyOptional({ nullable: true })
  title: string | null;

  @ApiProperty({ type: [ConversationParticipantResponseDto] })
  participants: ConversationParticipantResponseDto[];

  @ApiPropertyOptional({ nullable: true })
  lastMessageId: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastMessageAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastMessagePreview: string | null;

  @ApiProperty({ description: "My unread count in this thread" })
  unreadCount: number;

  @ApiPropertyOptional({ nullable: true })
  lastReadMessageId: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastReadAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  lastDeliveredMessageId: string | null;

  @ApiProperty({ description: "My own unread-until read-state, from my point of view" })
  readState: MessageDeliveryState;

  @ApiProperty()
  isMuted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class MessageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ format: "uuid" })
  conversationId: string;

  @ApiProperty({ format: "uuid" })
  senderId: string;

  @ApiPropertyOptional({ nullable: true })
  senderName: string | null;

  @ApiProperty({ enum: MessageType })
  type: MessageType;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiPropertyOptional({ nullable: true, format: "uuid" })
  replyToId: string | null;

  @ApiProperty()
  clientMessageId: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true, nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  editedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class SendMessageResponseDto {
  @ApiProperty({ type: MessageResponseDto })
  message: MessageResponseDto;

  /**
   * True when `clientMessageId` had already been used in this conversation, so
   * this response is the original message rather than a new one. The client uses
   * it to collapse its optimistic bubble onto the authoritative row.
   */
  @ApiProperty({ description: "True when this send resolved to a previously stored message" })
  duplicate: boolean;
}

export class MessagePageResponseDto {
  @ApiProperty({ type: [MessageResponseDto], description: "Newest first" })
  data: MessageResponseDto[];

  @ApiProperty({ description: "Cursor to pass as `before` for the next (older) page; null when the thread start is reached" })
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

export class ConversationPageResponseDto {
  @ApiProperty({ type: [ConversationResponseDto], description: "Most recently active first" })
  data: ConversationResponseDto[];

  @ApiProperty()
  nextCursor: string | null;

  @ApiProperty()
  hasMore: boolean;
}

export class ReadStateResponseDto {
  @ApiProperty({ format: "uuid" })
  conversationId: string;

  @ApiPropertyOptional({ nullable: true, format: "uuid" })
  lastReadMessageId: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastReadAt: Date | null;

  @ApiProperty({ description: "Unread count after applying the update" })
  unreadCount: number;
}

export class DeliveryStateResponseDto {
  @ApiProperty({ format: "uuid" })
  conversationId: string;

  @ApiPropertyOptional({ nullable: true, format: "uuid" })
  lastDeliveredMessageId: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastDeliveredAt: Date | null;

  @ApiProperty({ description: "Receipt rows written by this update" })
  receiptsUpdated: number;
}
