import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";

export class ExerciseResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id: string;

  @ApiProperty({ example: "Barbell Bench Press" })
  title: string;

  @ApiProperty({ example: "barbell-bench-press" })
  slug: string;

  @ApiProperty({ example: "A compound chest exercise performed on a flat bench." })
  description: string;

  @ApiProperty({ type: [String], example: ["uploads/exercises/image.jpg"] })
  images: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedExerciseResponseDto extends PaginatedResponseDto<ExerciseResponseDto> {
  @ApiProperty({ type: [ExerciseResponseDto] })
  declare data: ExerciseResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
