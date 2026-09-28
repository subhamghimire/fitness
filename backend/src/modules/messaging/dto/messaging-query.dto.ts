import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { ConversationType, MessageType } from "../enums";

/** `?before=<ISO timestamp>` — the keyset cursor for message history. */
export class MessageQueryDto {
  @ApiPropertyOptional({ description: "Cursor: return messages strictly older than this ISO timestamp", format: "date-time" })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;

  @ApiPropertyOptional({ enum: [MessageType.TEXT, MessageType.IMAGE] })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;
}

export class ConversationQueryDto {
  @ApiPropertyOptional({ enum: ConversationType })
  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: "Cursor: return conversations whose last activity is strictly older than this ISO timestamp", format: "date-time" })
  @IsOptional()
  @IsString()
  before?: string;
}

export class UpdateReadStateDto {
  /**
   * High-water mark. Omitting it means "I have read everything currently in the
   * thread", which is what a client does when it opens a conversation — that is
   * the overwhelmingly common call and should not require the client to know
   * the newest message id.
   */
  @ApiPropertyOptional({ format: "uuid", description: "Omit to mark the whole conversation read" })
  @IsOptional()
  @IsString()
  lastReadMessageId?: string;
}

export class UpdateDeliveryStateDto {
  @ApiProperty({ format: "uuid", description: "Highest message id the client has on device" })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastDeliveredMessageId: string;
}

export class UpdateConversationDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: "Mute notifications for this thread" })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === "true" || value === "1")
  isMuted?: boolean;
}

export class RemoveParticipantDto {
  @ApiProperty({ format: "uuid" })
  @IsString()
  userId: string;
}

/** Shape returned to a client for the `typing` frame. */
export class TypingIndicatorDto {
  @ApiProperty({ format: "uuid" })
  @IsString()
  conversationId: string;

  @ApiProperty()
  isTyping: boolean;
}

export class MessageFilterQueryDto {
  @ApiPropertyOptional({ enum: [MessageType.TEXT, MessageType.IMAGE], isArray: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined))
  @IsArray()
  @IsEnum(MessageType, { each: true })
  type?: MessageType[];
}
