import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDate, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { CoachVerificationStatus } from "../enums";

export class UpdateCoachVerificationDto {
  @ApiProperty({ enum: CoachVerificationStatus, description: "Target verification state (admin action)" })
  @IsEnum(CoachVerificationStatus)
  status: CoachVerificationStatus;

  @ApiPropertyOptional({ example: "Documents look authentic", description: "Decision note or rejection reason" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionNote?: string;

  @ApiPropertyOptional({ description: "Optional explicit expiry for VERIFIED state" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
