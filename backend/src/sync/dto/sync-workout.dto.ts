import { IsString, IsUUID, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
export class SyncSetDto { @IsUUID() id: string; @IsOptional() @IsNumber() weight: number | null; @IsOptional() @IsNumber() reps: number | null; @IsOptional() @IsNumber() rpe: number | null; @IsBoolean() isWarmup: boolean; }
export class SyncExerciseDto { @IsUUID() id: string; @IsString() name: string; @IsNumber() orderIndex: number; @IsArray() @ValidateNested({ each: true }) @Type(() => SyncSetDto) sets: SyncSetDto[]; }
export class SyncWorkoutDataDto { @IsUUID() id: string; @IsDateString() startedAt: string; @IsOptional() @IsDateString() endedAt: string | null; @IsArray() @ValidateNested({ each: true }) @Type(() => SyncExerciseDto) exercises: SyncExerciseDto[]; }
export class SyncWorkoutDto { @ValidateNested() @Type(() => SyncWorkoutDataDto) workout: SyncWorkoutDataDto; }
