import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsInt, Min, Max, MaxLength, MinLength } from 'class-validator';

export class CreateCoachDto {
  @ApiProperty({ example: 'John Smith', description: 'Coach name' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Certified personal trainer with 10 years experience...', description: 'Coach biography' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: false, default: false, description: 'Verification status' })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({ example: 0, default: 0, description: 'Coach rank/priority' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rank?: number;
}
