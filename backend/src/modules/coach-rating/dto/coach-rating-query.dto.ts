import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';

export class CoachRatingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by coach ID' })
  @IsOptional()
  @IsUUID()
  coachId?: string;
}
