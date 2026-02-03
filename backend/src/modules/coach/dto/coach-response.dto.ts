import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResponseDto, PaginationMeta } from 'src/common/dto';

export class CoachResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'John Smith' })
  name: string;

  @ApiProperty({ example: false })
  isVerified: boolean;

  @ApiPropertyOptional({ example: 'Certified personal trainer...' })
  bio: string | null;

  @ApiProperty({ example: 0 })
  rank: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Number of documents' })
  documentCount?: number;
}

export class PaginatedCoachResponseDto extends PaginatedResponseDto<CoachResponseDto> {
  @ApiProperty({ type: [CoachResponseDto] })
  declare data: CoachResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
