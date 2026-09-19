import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsUUID } from "class-validator";
import { PaginationQueryDto } from "src/common/dto";
import { CoachDocumentStatus, CoachDocumentType } from "../enums";

export class CoachDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Filter by coach ID (admin only; owners are always scoped to themselves)" })
  @IsOptional()
  @IsUUID()
  coachId?: string;

  @ApiPropertyOptional({ enum: CoachDocumentStatus, description: "Filter by status" })
  @IsOptional()
  @IsEnum(CoachDocumentStatus)
  status?: CoachDocumentStatus;

  @ApiPropertyOptional({ enum: CoachDocumentType, description: "Filter by type" })
  @IsOptional()
  @IsEnum(CoachDocumentType)
  type?: CoachDocumentType;
}
