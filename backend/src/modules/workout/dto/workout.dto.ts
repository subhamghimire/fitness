import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { PaginationQueryDto } from "src/common/dto";

export class WorkoutHistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Only sessions started at or after this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  from?: Date;

  @ApiPropertyOptional({ description: "Only sessions started at or before this timestamp (ISO)" })
  @IsOptional()
  @Type(() => Date)
  to?: Date;

  @ApiPropertyOptional({ description: "Only sessions that include this exercise" })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @ApiPropertyOptional({ description: "Free-text search on the workout name" })
  @IsOptional()
  search?: string;
}

export class RecentWorkoutsQueryDto {
  @ApiPropertyOptional({ default: 5, description: "Number of recent workouts to return (max 30)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit: number = 5;
}

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

export class WorkoutTemplateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: "Free-text search on the template name" })
  @IsOptional()
  search?: string;
}

export class CreateWorkoutTemplateDto {
  @ApiProperty({ example: "Push Day A" })
  name: string;

  @ApiPropertyOptional({ type: "array", description: "Exercises planned in the template" })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutTemplateExerciseDto)
  exercises?: CreateWorkoutTemplateExerciseDto[];
}

export class CreateWorkoutTemplateExerciseDto {
  @ApiPropertyOptional({ description: "Reference to the reusable exercise catalog" })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @ApiProperty({ example: "Bench Press" })
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: "Rest after this exercise, seconds" })
  @IsOptional()
  @IsInt()
  @Min(0)
  restSeconds?: number;

  @ApiPropertyOptional({ type: "array" })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutTemplateSetDto)
  sets?: CreateWorkoutTemplateSetDto[];
}

export class CreateWorkoutTemplateSetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  reps?: number;

  @ApiPropertyOptional({ description: "Rate of perceived exertion (1-10)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  rpe?: number;

  @ApiPropertyOptional()
  @IsOptional()
  isWarmup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  isDropset?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  isFailure?: boolean;

  @ApiPropertyOptional({ description: "Set duration in seconds (conditioning)" })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional({ description: "Distance in meters (conditioning)" })
  @IsOptional()
  distance?: number;
}
