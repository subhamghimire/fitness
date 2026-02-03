import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto';
import { CoachDocumentStatus } from '../enums';

export class CoachDocumentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by coach ID' })
  @IsOptional()
  @IsUUID()
  coachId?: string;

  @ApiPropertyOptional({ enum: CoachDocumentStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(CoachDocumentStatus)
  status?: CoachDocumentStatus;
}
