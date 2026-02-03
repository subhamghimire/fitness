import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';

export class CreateExerciseDto {
  @ApiProperty({ example: 'Barbell Bench Press', description: 'Exercise title' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: 'barbell-bench-press', description: 'Unique URL slug' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug: string;

  @ApiProperty({ example: 'A compound chest exercise...', description: 'Exercise description' })
  @IsString()
  @MinLength(10)
  description: string;

  @ApiPropertyOptional({ type: [String], description: 'Image URLs (handled via upload endpoint)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
