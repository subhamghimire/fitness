import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateUserWorkoutDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'Exercise UUID' })
  @IsUUID()
  exerciseId: string;

  @ApiPropertyOptional({ example: 'Focus on form', description: 'Personal notes for this exercise' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
