import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";

export class FavoriteExerciseResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  exerciseId: string;

  @ApiPropertyOptional()
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ description: "Exercise details when included" })
  exercise?: {
    id: string;
    title: string;
    slug: string;
  };
}

export class PaginatedFavoriteExerciseResponseDto extends PaginatedResponseDto<FavoriteExerciseResponseDto> {
  @ApiProperty({ type: [FavoriteExerciseResponseDto] })
  declare data: FavoriteExerciseResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
