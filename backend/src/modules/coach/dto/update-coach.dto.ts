import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { CoachAccountStatus, CoachEligibility } from "../enums";

export class UpdateCoachDto {
  @ApiPropertyOptional({ example: "John Smith", description: "Coach name" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 5, description: "Coach rank/priority (admin)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  rank?: number;

  @ApiPropertyOptional({ enum: CoachAccountStatus, description: "Account status (admin)" })
  @IsOptional()
  @IsEnum(CoachAccountStatus)
  accountStatus?: CoachAccountStatus;

  @ApiPropertyOptional({ enum: CoachEligibility, description: "Coach eligibility (admin)" })
  @IsOptional()
  @IsEnum(CoachEligibility)
  eligibility?: CoachEligibility;
}
