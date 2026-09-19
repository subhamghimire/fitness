import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { CoachDocumentStatus, CoachDocumentType } from "../enums";

export class UpdateCoachDocumentDto {
  @ApiPropertyOptional({ enum: CoachDocumentStatus, description: "Review decision (admin only)" })
  @IsOptional()
  @IsEnum(CoachDocumentStatus)
  status?: CoachDocumentStatus;

  @ApiPropertyOptional({ enum: CoachDocumentType, description: "Document type (owner)" })
  @IsOptional()
  @IsEnum(CoachDocumentType)
  type?: CoachDocumentType;

  @ApiPropertyOptional({ example: "CSCS Certification" })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({ example: ["certified"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  badges?: string[];
}
