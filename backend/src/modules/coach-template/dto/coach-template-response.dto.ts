import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResponseDto, PaginationMeta } from 'src/common/dto';
import { CoachTemplateType, DiscountType } from '../enums/coach-template.enum';

export class CoachTemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  price: number;

  @ApiProperty({ enum: CoachTemplateType })
  type: CoachTemplateType;

  @ApiPropertyOptional()
  discount: number | null;

  @ApiPropertyOptional({ enum: DiscountType })
  discountType: DiscountType | null;

  @ApiProperty({ description: 'Final price after discount' })
  finalPrice: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedCoachTemplateResponseDto extends PaginatedResponseDto<CoachTemplateResponseDto> {
  @ApiProperty({ type: [CoachTemplateResponseDto] })
  declare data: CoachTemplateResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
