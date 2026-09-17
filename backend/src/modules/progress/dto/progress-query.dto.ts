import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min, IsUUID } from "class-validator";
import { PaginationQueryDto } from "src/common/dto";
import { FrequencyGranularity, PersonalRecordType, VolumeGranularity } from "../enums/progress.enum";

export class OverviewQueryDto {
  @ApiPropertyOptional({ default: 12, description: "Number of recent weekly buckets to include in the frequency series" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(52)
  weeks: number = 12;
}

export class ExerciseListQueryDto extends PaginationQueryDto {}

export class ExerciseHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Only sessions started at or after this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: "Only sessions started at or before this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  to?: Date;
}

export class PersonalRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PersonalRecordType, description: "Filter PRs by record type" })
  @IsOptional()
  @IsEnum(PersonalRecordType)
  prType?: PersonalRecordType;

  @ApiPropertyOptional({ description: "Filter PRs for a single exercise" })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;
}

export class VolumeHistoryQueryDto {
  @ApiPropertyOptional({ enum: VolumeGranularity, default: VolumeGranularity.WEEK, description: "Time bucket for the series" })
  @IsOptional()
  @IsEnum(VolumeGranularity)
  granularity: VolumeGranularity = VolumeGranularity.WEEK;

  @ApiPropertyOptional({ description: "Only workouts started at or after this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: "Only workouts started at or before this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  to?: Date;
}

export class WorkoutFrequencyQueryDto {
  @ApiPropertyOptional({ enum: FrequencyGranularity, default: FrequencyGranularity.WEEK, description: "Time bucket for the series" })
  @IsOptional()
  @IsEnum(FrequencyGranularity)
  granularity: FrequencyGranularity = FrequencyGranularity.WEEK;

  @ApiPropertyOptional({ default: 12, description: "Number of most recent buckets to return" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(104)
  periods: number = 12;

  @ApiPropertyOptional({ description: "Only workouts started at or after this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: "Only workouts started at or before this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  to?: Date;
}
