import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";
import { NotificationType } from "../enums";

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiPropertyOptional({ type: "object", additionalProperties: true })
  data: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  actorId: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceType: string | null;

  @ApiPropertyOptional({ nullable: true })
  sourceId: string | null;

  @ApiPropertyOptional({ nullable: true })
  actionUrl: string | null;

  @ApiProperty({ nullable: true, description: "null while unread" })
  readAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedNotificationResponseDto extends PaginatedResponseDto<NotificationResponseDto> {
  @ApiProperty({ type: [NotificationResponseDto] })
  declare data: NotificationResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class NotificationUnreadCountDto {
  @ApiProperty({ example: 4 })
  unread: number;
}

export class NotificationMarkReadResultDto {
  @ApiProperty({ example: 3 })
  updated: number;
}

export class NotificationPreferenceResponseDto {
  @ApiProperty()
  inAppEnabled: boolean;

  @ApiProperty()
  pushEnabled: boolean;

  @ApiProperty()
  emailEnabled: boolean;

  @ApiProperty({ enum: NotificationType, isArray: true })
  mutedTypes: NotificationType[];

  @ApiProperty({ type: [String] })
  deviceTokens: string[];
}
