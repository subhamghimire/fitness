import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { CursorPageMetaDto, CursorQueryDto } from "src/common/dto";
import { SOCIAL_CONTENT_LIMITS } from "src/common/social";
import { ReportReason, ReportStatus, ReportTargetType } from "../enums";

/**
 * `POST /social/reports`
 *
 * One body for all three target types, discriminated by `targetType` + the
 * matching id. Three separate endpoints would each need their own "does this
 * exist and may I see it" logic and would drift; a discriminated body makes the
 * type/reference agreement checkable in exactly one place.
 *
 * The ids are declared `optional` at the DTO level and required by a service
 * check instead, because "which id is required" depends on `targetType` and
 * `@ValidateIf` on three mutually-exclusive fields is harder to read — and
 * easier to get subtly wrong — than one explicit switch in the service, which
 * also has to resolve the target anyway.
 */
export class CreateReportDto {
  @ApiProperty({
    enum: ReportTargetType,
    description: "`user` is the only way to report behaviour that leaves no artifact, and the only path for content the reporter cannot see."
  })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiPropertyOptional({ format: "uuid", description: "Required when targetType is `user`" })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Required when targetType is `post`" })
  @IsOptional()
  @IsUUID()
  postId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Required when targetType is `comment`" })
  @IsOptional()
  @IsUUID()
  commentId?: string;

  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({
    maxLength: SOCIAL_CONTENT_LIMITS.REPORT_DETAILS_MAX_LENGTH,
    description: "Optional by design: the closed reason list is the triage signal, and a mandatory paragraph makes people click through rather than report."
  })
  @IsOptional()
  @IsString()
  @MaxLength(SOCIAL_CONTENT_LIMITS.REPORT_DETAILS_MAX_LENGTH)
  details?: string;
}

/**
 * `GET /social/reports` — the caller's own report history.
 *
 * Scoped to the reporter in the service, not by a query parameter. There is
 * deliberately no way to ask for "everyone's reports": that is a moderation
 * tool's query, and it belongs in a tool with its own authorisation, not on a
 * public endpoint where a missing `reporterId` filter would expose the queue.
 */
export class ReportQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus, description: "Filter by triage state" })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;
}

export class ReportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ReportTargetType })
  targetType: ReportTargetType;

  @ApiProperty({ format: "uuid", nullable: true })
  userId: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  postId: string | null;

  @ApiProperty({ format: "uuid", nullable: true })
  commentId: string | null;

  @ApiProperty({ enum: ReportReason })
  reason: ReportReason;

  @ApiProperty({ maxLength: SOCIAL_CONTENT_LIMITS.REPORT_DETAILS_MAX_LENGTH, nullable: true })
  details: string | null;

  @ApiProperty({ enum: ReportStatus, description: "Where this report is in triage. Set by moderators; not yet acted on automatically." })
  status: ReportStatus;

  @ApiProperty({ format: "uuid", nullable: true, description: "Who wrote the reported thing, captured at report time so the report survives the target" })
  targetAuthorId: string | null;

  @ApiProperty({ maxLength: 500, nullable: true, description: "A bounded excerpt of the reported content, captured at report time. Never shown to any user but the reporter." })
  targetExcerpt: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  resolvedAt?: Date | null;
}

export class ReportPageResponseDto {
  @ApiProperty({ type: [ReportResponseDto] })
  data: ReportResponseDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}
