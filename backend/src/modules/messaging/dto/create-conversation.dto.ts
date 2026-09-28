import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { JsonObject } from "src/common/json";
import { CONVERSATION_MAX_PARTICIPANTS, MessageType } from "../enums";

export class CreateDirectConversationDto {
  /**
   * The other participant. Deliberately a single field rather than a
   * participant list: a direct thread is defined by its two ends, and deriving
   * the `directKey` from the ordered pair is what makes the thread
   * un-duplicatable. Repeating yourself is a no-op, not an error.
   */
  @ApiProperty({ format: "uuid", description: "The other participant's user id" })
  @IsUUID()
  participantId: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class CreateGroupConversationDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, description: "Everyone who will be in the thread, including you" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONVERSATION_MAX_PARTICIPANTS)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  participantIds: string[];

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;
}

export class AddParticipantsDto {
  @ApiProperty({ type: [String], format: "uuid" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONVERSATION_MAX_PARTICIPANTS)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  participantIds: string[];
}

export class SendMessageDto {
  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @ApiPropertyOptional({ description: "Message text. Required for text messages." })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true, description: "Attachment descriptors for non-text messages" })
  @IsOptional()
  metadata?: JsonObject;

  /**
   * Client-generated idempotency key.
   *
   * Required rather than optional, because it is the only thing standing between
   * a mobile client on a flaky connection and a duplicated message. The unique
   * `(conversation, sender, clientMessageId)` index means a retry resolves to the
   * original row and the response carries `duplicate: true` so the client can
   * reconcile its optimistic bubble.
   */
  @ApiProperty({ maxLength: 100, description: "Client-generated id; a retried send with the same value is deduplicated" })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  clientMessageId: string;
}
