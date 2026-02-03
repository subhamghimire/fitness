import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from 'src/common/dto';

export class CoachQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'John', description: 'Search by name or bio' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: true, description: 'Filter by verified status' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ enum: ['name', 'rank', 'createdAt'], default: 'rank', description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: 'name' | 'rank' | 'createdAt' = 'rank';
}
