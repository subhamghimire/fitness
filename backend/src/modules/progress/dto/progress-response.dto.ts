import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";
import { PersonalRecordType } from "../enums/progress.enum";

export class WorkoutFrequencyEntryDto {
  @ApiProperty({ description: "Bucket start (UTC)" })
  bucket: Date;

  @ApiProperty()
  count: number;
}

export class VolumeHistoryEntryDto {
  @ApiProperty({ description: "Bucket start (UTC)" })
  bucket: Date;

  @ApiProperty()
  workoutCount: number;

  @ApiProperty({ description: "Total working-set volume in kg" })
  volumeKg: number;

  @ApiProperty()
  totalReps: number;
}

export class ExerciseHistoryEntryDto {
  @ApiProperty()
  workoutId: string;

  @ApiProperty()
  workoutExerciseId: string;

  @ApiPropertyOptional()
  workoutName: string | null;

  @ApiPropertyOptional()
  name: string | null;

  @ApiProperty()
  startedAt: Date;

  @ApiProperty()
  setCount: number;

  @ApiProperty()
  reps: number;

  @ApiProperty({ description: "Session working-set volume in kg" })
  volumeKg: number;

  @ApiPropertyOptional()
  bestWeightKg: number | null;

  @ApiPropertyOptional()
  bestReps: number | null;

  @ApiPropertyOptional({ description: "Epley 1RM estimate for the best set" })
  bestEstimated1RmKg: number | null;

  @ApiPropertyOptional()
  bestDistanceM: number | null;

  @ApiPropertyOptional()
  bestTimeSeconds: number | null;
}

export class PaginatedExerciseHistoryResponseDto extends PaginatedResponseDto<ExerciseHistoryEntryDto> {
  @ApiProperty({ type: [ExerciseHistoryEntryDto] })
  declare data: ExerciseHistoryEntryDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class PersonalRecordResponseDto {
  @ApiProperty({ enum: PersonalRecordType })
  prType: PersonalRecordType;

  @ApiProperty({ description: "Unit encoded by prType (kg / reps / m / s)" })
  value: number;

  @ApiPropertyOptional()
  exerciseId: string | null;

  @ApiPropertyOptional()
  exerciseName: string | null;

  @ApiProperty()
  workoutId: string;

  @ApiProperty()
  workoutExerciseId: string;

  @ApiProperty()
  achievedAt: Date;

  @ApiProperty({ description: "Whether this row is still the absolute best for its type" })
  isCurrent: boolean;
}

export class PaginatedPersonalRecordResponseDto extends PaginatedResponseDto<PersonalRecordResponseDto> {
  @ApiProperty({ type: [PersonalRecordResponseDto] })
  declare data: PersonalRecordResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class ExerciseBestDto {
  @ApiPropertyOptional()
  value: number | null;

  @ApiPropertyOptional()
  workoutId: string | null;

  @ApiPropertyOptional()
  workoutExerciseId: string | null;

  @ApiPropertyOptional()
  achievedAt: Date | null;
}

export class ExerciseStatResponseDto {
  @ApiProperty()
  exerciseId: string;

  @ApiPropertyOptional()
  exerciseName: string | null;

  @ApiProperty()
  workoutCount: number;

  @ApiProperty({ description: "Lifetime working-set volume in kg" })
  totalVolumeKg: number;

  @ApiProperty()
  totalReps: number;

  @ApiPropertyOptional()
  firstPerformedAt: Date | null;

  @ApiPropertyOptional()
  lastPerformedAt: Date | null;

  @ApiProperty({ type: ExerciseBestDto })
  bestWeightKg: ExerciseBestDto;

  @ApiProperty({ type: ExerciseBestDto })
  bestReps: ExerciseBestDto;

  @ApiProperty({ type: ExerciseBestDto })
  bestVolumeKg: ExerciseBestDto;

  @ApiProperty({ type: ExerciseBestDto })
  bestEstimated1RmKg: ExerciseBestDto;

  @ApiProperty({ type: ExerciseBestDto })
  bestDistanceM: ExerciseBestDto;

  @ApiProperty({ type: ExerciseBestDto })
  bestTimeSeconds: ExerciseBestDto;
}

export class PaginatedExerciseStatResponseDto extends PaginatedResponseDto<ExerciseStatResponseDto> {
  @ApiProperty({ type: [ExerciseStatResponseDto] })
  declare data: ExerciseStatResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class ProgressOverviewResponseDto {
  @ApiProperty()
  totalWorkouts: number;

  @ApiProperty({ description: "Lifetime working-set volume in kg" })
  totalVolumeKg: number;

  @ApiProperty()
  totalReps: number;

  @ApiProperty({ description: "Seconds" })
  totalDurationSeconds: number;

  @ApiProperty({ description: "Avg seconds per workout" })
  avgDurationSeconds: number;

  @ApiProperty({ description: "Distinct calendar days with at least one workout" })
  activeDays: number;

  @ApiPropertyOptional()
  firstWorkoutAt: Date | null;

  @ApiPropertyOptional()
  lastWorkoutAt: Date | null;

  @ApiProperty({ type: [WorkoutFrequencyEntryDto], description: "Weekly workout count over the last N weeks" })
  weeklyWorkoutFrequency: WorkoutFrequencyEntryDto[];
}
