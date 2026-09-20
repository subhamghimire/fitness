import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { PaginationQueryDto } from "src/common/dto";

/** Trailing window used by every dashboard metric (default: last 28 days). */
export class CoachWindowQueryDto {
  @ApiPropertyOptional({ default: 28, description: "Trailing window in days for adherence/missed/recent metrics (max 90)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  windowDays?: number;
}

export class CoachDashboardQueryDto extends CoachWindowQueryDto {
  @ApiPropertyOptional({ default: 12, description: "Number of recent weekly buckets for the progress trend series (max 52)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  weeks?: number;
}

export class CoachClientListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 28, description: "Trailing window in days for adherence/missed/recent metrics (max 90)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  windowDays?: number;
}

export class CoachClientDetailQueryDto extends CoachDashboardQueryDto {
  @ApiPropertyOptional({ default: 5, description: "Number of recent workouts / PRs / progression sessions to include" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  recentLimit?: number;
}

export class CoachActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 90, description: "Only show activity logged inside the trailing N days (max 365)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  windowDays?: number;
}
