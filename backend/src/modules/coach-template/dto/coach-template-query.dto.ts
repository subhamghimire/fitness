import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsEnum, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from 'src/common/dto';
import { CoachTemplateType } from '../enums/coach-template.enum';

export class CoachTemplateQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by coach ID' })
  @IsOptional()
  @IsUUID()
  coachId?: string;

  @ApiPropertyOptional({ enum: CoachTemplateType, description: 'Filter by type' })
  @IsOptional()
  @IsEnum(CoachTemplateType)
  type?: CoachTemplateType;

  @ApiPropertyOptional({ description: 'Max price filter' })
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  maxPrice?: number;
}
