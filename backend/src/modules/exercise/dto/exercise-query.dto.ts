import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';

export class ExerciseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'bench', description: 'Search by title or description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['title', 'createdAt'], default: 'title', description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: 'title' | 'createdAt' = 'title';
}
