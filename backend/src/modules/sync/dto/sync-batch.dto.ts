import {
  IsString,
  IsUUID,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsIn,
  IsDateString,
  ValidateIf
} from "class-validator";
import { Type } from "class-transformer";

export class SyncChangeItemDto {
  @IsIn(["upsert", "delete"])
  op: "upsert" | "delete";

  @IsUUID()
  id: string;

  @IsNumber()
  revision: number;

  @IsDateString()
  localUpdatedAt: string;

  @IsOptional()
  payload?: Record<string, unknown> | null;
}

export class SyncBatchChangesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  workouts?: SyncChangeItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  workoutExercises?: SyncChangeItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  sets?: SyncChangeItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  templates?: SyncChangeItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  templateExercises?: SyncChangeItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  @IsOptional()
  templateSets?: SyncChangeItemDto[];
}

export class SyncBatchRequestDto {
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  lastSyncToken?: string | null;

  @IsUUID()
  clientId: string;

  @ValidateNested()
  @Type(() => SyncBatchChangesDto)
  changes: SyncBatchChangesDto;
}

// Re-export legacy DTO pieces used by old endpoint
export {
  SyncWorkoutDto,
  SyncWorkoutDataDto,
  SyncExerciseDto,
  SyncSetDto
} from "./sync-workout.dto";
