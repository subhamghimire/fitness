import { IsOptional, IsInt, IsString, IsDateString, IsEnum, IsBoolean } from "class-validator";
import { Type } from "class-transformer";
import { Gender } from "../enums";
import { PaginationQueryDto } from "src/common/dto";
import { ApiPropertyOptional, OmitType } from "@nestjs/swagger";

export class UserQueryDto extends OmitType(PaginationQueryDto, ["sortOrder"]) {
  @ApiPropertyOptional({ description: "Search by name or email", example: "john" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by age", example: 25 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  age?: number;

  @ApiPropertyOptional({ description: "Filter by gender", enum: Gender, example: Gender.MALE })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ description: "Filter users created from this date (ISO string)", example: "2026-01-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: "Filter users created until this date (ISO string)", example: "2026-02-01T00:00:00.000Z" })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: "Filter by soft-deleted users", example: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isDeleted?: boolean;
}
