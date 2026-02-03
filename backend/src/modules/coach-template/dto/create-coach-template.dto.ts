import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsNumber, IsOptional, IsEnum, MaxLength, Min } from 'class-validator';
import { CoachTemplateType, DiscountType } from '../enums/coach-template.enum';

export class CreateCoachTemplateDto {
  @ApiProperty({ description: 'Coach UUID' })
  @IsUUID()
  coachId: string;

  @ApiProperty({ example: 'Beginner Workout Plan', description: 'Template title' })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: 49.99, description: 'Price' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiProperty({ enum: CoachTemplateType, example: CoachTemplateType.TEMPLATE })
  @IsEnum(CoachTemplateType)
  type: CoachTemplateType;

  @ApiPropertyOptional({ example: 10, description: 'Discount amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ enum: DiscountType, example: DiscountType.PERCENTAGE })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;
}
