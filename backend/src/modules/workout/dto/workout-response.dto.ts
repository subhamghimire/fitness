import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";

export class SetResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderIndex: number;

  @ApiPropertyOptional()
  weight: number | null;

  @ApiPropertyOptional()
  reps: number | null;

  @ApiPropertyOptional()
  rpe: number | null;

  @ApiProperty()
  isWarmup: boolean;

  @ApiProperty()
  isDropset: boolean;

  @ApiProperty()
  isFailure: boolean;

  @ApiPropertyOptional()
  durationSeconds: number | null;

  @ApiPropertyOptional()
  distance: number | null;
}

export class WorkoutExerciseSummaryDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  exerciseId: string | null;

  @ApiPropertyOptional()
  name: string | null;

  @ApiProperty()
  orderIndex: number;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiPropertyOptional()
  restSeconds: number | null;

  @ApiPropertyOptional({ description: "Catalog exercise when still resolvable" })
  exercise?: { id: string; title: string; slug: string };

  @ApiProperty({ type: [SetResponseDto] })
  sets: SetResponseDto[];
}

export class WorkoutDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  endedAt: Date | null;

  @ApiPropertyOptional()
  durationSeconds: number | null;

  @ApiProperty()
  revision: number;

  @ApiProperty({ type: [WorkoutExerciseSummaryDto] })
  exercises: WorkoutExerciseSummaryDto[];
}

export class WorkoutSummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  endedAt: Date | null;

  @ApiPropertyOptional()
  durationSeconds: number | null;

  @ApiProperty()
  exerciseCount: number;

  @ApiProperty()
  setCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ExerciseHistoryEntryDto {
  @ApiProperty()
  workoutId: string;

  @ApiPropertyOptional()
  workoutName: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiPropertyOptional()
  endedAt: Date | null;

  @ApiProperty({ type: WorkoutExerciseSummaryDto })
  exercise: WorkoutExerciseSummaryDto;
}

export class PaginatedWorkoutSummaryResponseDto extends PaginatedResponseDto<WorkoutSummaryResponseDto> {
  @ApiProperty({ type: [WorkoutSummaryResponseDto] })
  declare data: WorkoutSummaryResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class PaginatedWorkoutDetailResponseDto extends PaginatedResponseDto<WorkoutDetailResponseDto> {
  @ApiProperty({ type: [WorkoutDetailResponseDto] })
  declare data: WorkoutDetailResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class PaginatedExerciseHistoryResponseDto extends PaginatedResponseDto<ExerciseHistoryEntryDto> {
  @ApiProperty({ type: [ExerciseHistoryEntryDto] })
  declare data: ExerciseHistoryEntryDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class RecentWorkoutsResponseDto {
  @ApiProperty({ type: [WorkoutSummaryResponseDto] })
  data: WorkoutSummaryResponseDto[];
}
