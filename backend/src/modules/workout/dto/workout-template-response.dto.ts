import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";
import { SetResponseDto } from "./workout-response.dto";

export class WorkoutTemplateSetResponseDto extends SetResponseDto {}

export class WorkoutTemplateExerciseResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  exerciseId: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: "Planned order in the template" })
  orderIndex: number;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiPropertyOptional({ description: "Planned rest after this exercise, seconds" })
  restSeconds: number | null;

  @ApiPropertyOptional({ description: "Catalog exercise when still resolvable" })
  exercise?: { id: string; title: string; slug: string };

  @ApiProperty({ type: [WorkoutTemplateSetResponseDto] })
  sets: WorkoutTemplateSetResponseDto[];
}

export class WorkoutTemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  revision: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [WorkoutTemplateExerciseResponseDto] })
  exercises: WorkoutTemplateExerciseResponseDto[];
}

export class WorkoutTemplateListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  exerciseCount: number;

  @ApiProperty()
  revision: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedWorkoutTemplateResponseDto extends PaginatedResponseDto<WorkoutTemplateListItemDto> {
  @ApiProperty({ type: [WorkoutTemplateListItemDto] })
  declare data: WorkoutTemplateListItemDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class PaginatedWorkoutTemplateDetailResponseDto extends PaginatedResponseDto<WorkoutTemplateResponseDto> {
  @ApiProperty({ type: [WorkoutTemplateResponseDto] })
  declare data: WorkoutTemplateResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
