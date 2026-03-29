import { IsString, IsUUID, IsOptional, ValidateIf, IsNumber, IsBoolean, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncSetDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsNumber()
  orderIndex?: number;

  @IsOptional()
  @IsNumber()
  weight?: number | null;

  @IsOptional()
  @IsNumber()
  reps?: number | null;

  @IsOptional()
  @IsNumber()
  rpe?: number | null;

  @IsOptional()
  @IsBoolean()
  isWarmup?: boolean;

  @IsOptional()
  @IsBoolean()
  isDropset?: boolean;

  @IsOptional()
  @IsBoolean()
  isFailure?: boolean;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number | null;

  @IsOptional()
  @IsNumber()
  distance?: number | null;
}

export class SyncExerciseDto {
  @IsUUID()
  id: string;

  @ValidateIf((o) => o.exerciseId !== undefined && o.exerciseId !== null && o.exerciseId !== '')
  @IsUUID()
  exerciseId?: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsNumber()
  orderIndex: number;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsNumber()
  restSeconds?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncSetDto)
  sets: SyncSetDto[];
}

export class SyncWorkoutDataDto {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsDateString()
  startedAt: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string | null;

  @IsOptional()
  @IsNumber()
  durationSeconds?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncExerciseDto)
  exercises: SyncExerciseDto[];
}

export class SyncWorkoutDto {
  @ValidateNested()
  @Type(() => SyncWorkoutDataDto)
  workout: SyncWorkoutDataDto;
}
