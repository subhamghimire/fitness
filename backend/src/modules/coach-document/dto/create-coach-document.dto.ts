import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsUUID, IsEnum, MaxLength } from 'class-validator';
import { CoachDocumentStatus } from '../enums';

export class CreateCoachDocumentDto {
  @ApiProperty({ description: 'Coach UUID' })
  @IsUUID()
  coachId: string;

  @ApiProperty({ example: 'Certification', description: 'Document title' })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: '/uploads/documents/cert.jpg', description: 'Document image URL' })
  @IsString()
  imageUrl: string;

  @ApiPropertyOptional({ example: ['certified', 'verified'], description: 'Document badges' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  badges?: string[];

  @ApiPropertyOptional({ enum: CoachDocumentStatus, default: CoachDocumentStatus.PENDING })
  @IsOptional()
  @IsEnum(CoachDocumentStatus)
  status?: CoachDocumentStatus;
}
