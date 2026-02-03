import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResponseDto, PaginationMeta } from 'src/common/dto';

export class CoachRatingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 5 })
  ratingNo: number;

  @ApiPropertyOptional()
  comment: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedCoachRatingResponseDto extends PaginatedResponseDto<CoachRatingResponseDto> {
  @ApiProperty({ type: [CoachRatingResponseDto] })
  declare data: CoachRatingResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}

export class CoachRatingStatsDto {
  @ApiProperty()
  averageRating: number;

  @ApiProperty()
  totalRatings: number;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  distribution: Record<number, number>;
}
