import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { CoachDocumentType } from "../enums";

export class CreateCoachDocumentDto {
  @ApiProperty({ example: "CSCS Certification", description: "Document title" })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty({ description: "Id of a file previously uploaded via the Files module", format: "uuid" })
  @IsUUID()
  fileId: string;

  @ApiPropertyOptional({ enum: CoachDocumentType, default: CoachDocumentType.OTHER })
  @IsOptional()
  @IsEnum(CoachDocumentType)
  type?: CoachDocumentType;

  @ApiPropertyOptional({ example: ["certified"], description: "Document badges" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  badges?: string[];
}
