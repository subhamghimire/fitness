import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";

export class CreateProgramWorkoutDto {
  @ApiProperty({ description: "WorkoutTemplate to schedule on this day" })
  @IsUUID()
  workoutTemplateId: string;

  @ApiPropertyOptional({ description: "Display name; defaults to the template name" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: "Order within the day (0-based)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateProgramDayDto {
  @ApiProperty({ example: 1, description: "1-based week of the plan" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weekNumber: number;

  @ApiProperty({ example: 1, description: "1-based day within the week" })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dayNumber: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [CreateProgramWorkoutDto], description: "Workouts scheduled for this day" })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProgramWorkoutDto)
  workouts?: CreateProgramWorkoutDto[];
}

export class CreateProgramDto {
  @ApiProperty({ example: "12-week base hypertrophy" })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [CreateProgramDayDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProgramDayDto)
  days?: CreateProgramDayDto[];
}
