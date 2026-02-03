import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCoachRatingDto {
  @ApiProperty({ description: 'Coach UUID' })
  @IsUUID()
  coachId: string;

  @ApiProperty({ example: 5, description: 'Rating from 1-5' })
  @IsInt()
  @Min(1)
  @Max(5)
  ratingNo: number;

  @ApiPropertyOptional({ example: 'Great coach!', description: 'Optional comment' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
