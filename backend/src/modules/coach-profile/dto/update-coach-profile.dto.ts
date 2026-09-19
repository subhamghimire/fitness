import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, IsUrl, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { CoachProfileVisibility } from "src/modules/coach/enums";

export class CertificationDto {
  @ApiProperty({ example: "Certified Strength and Conditioning Specialist (CSCS)" })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: "NSCA" })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  issuer?: string;

  @ApiPropertyOptional({ example: 2018 })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;
}

export class SocialLinkDto {
  @ApiProperty({ example: "Instagram" })
  @IsString()
  @MaxLength(50)
  label: string;

  @ApiProperty({ example: "https://instagram.com/coach_john" })
  @IsUrl()
  @MaxLength(255)
  url: string;
}

export class UpdateCoachProfileDto {
  @ApiPropertyOptional({ example: "Certified personal trainer with 10 years of experience..." })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: "Helping busy people get stronger" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tagline?: string;

  @ApiPropertyOptional({ example: ["strength", "hypertrophy", "fat loss"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  specialties?: string[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  experienceYears?: number;

  @ApiPropertyOptional({ type: [CertificationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  certifications?: CertificationDto[];

  @ApiPropertyOptional({ example: "https://coachjohn.com" })
  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  websiteUrl?: string;

  @ApiPropertyOptional({ type: [SocialLinkDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  @ApiPropertyOptional({ description: "Visibility of the profile in public discovery", enum: CoachProfileVisibility })
  @IsOptional()
  @IsEnum(CoachProfileVisibility)
  visibility?: CoachProfileVisibility;

  @ApiPropertyOptional({ description: "Avatar image handled by the Files service", format: "uuid" })
  @IsOptional()
  @IsUUID()
  avatarImageId?: string;
}
