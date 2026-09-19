import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { Transform } from "class-transformer";
import { PaginationQueryDto } from "src/common/dto";
import { CoachVerificationStatus } from "../enums";

export class CoachQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: "John", description: "Search by name" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by verification state (admin only). Public discovery always returns verified coaches." })
  @IsOptional()
  @Transform(({ value }) => value as CoachVerificationStatus)
  @IsEnum(CoachVerificationStatus)
  verificationStatus?: CoachVerificationStatus;

  @ApiPropertyOptional({ enum: ["name", "rank", "createdAt", "averageRating"], default: "rank", description: "Sort field" })
  @IsOptional()
  @IsString()
  sortBy?: "name" | "rank" | "createdAt" | "averageRating" = "rank";
}
