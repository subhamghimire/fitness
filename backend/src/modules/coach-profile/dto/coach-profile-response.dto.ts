import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CoachProfileVisibility } from "src/modules/coach/enums";

export class CoachProfileResponseDto {
  @ApiProperty()
  coachId: string;

  @ApiPropertyOptional()
  bio: string | null;

  @ApiPropertyOptional()
  tagline: string | null;

  @ApiPropertyOptional({ type: [String] })
  specialties: string[] | null;

  @ApiPropertyOptional()
  experienceYears: number | null;

  @ApiPropertyOptional({ type: [Object] })
  certifications: { name: string; issuer?: string; year?: number }[] | null;

  @ApiPropertyOptional()
  websiteUrl: string | null;

  @ApiPropertyOptional({ type: [Object] })
  socialLinks: { label: string; url: string }[] | null;

  @ApiPropertyOptional({ format: "uuid" })
  avatarImageId: string | null;

  @ApiProperty({ enum: CoachProfileVisibility })
  visibility: CoachProfileVisibility;

  @ApiProperty({ example: 4.8 })
  averageRating: number;

  @ApiProperty({ example: 42 })
  ratingCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PublicCoachProfileDto {
  @ApiPropertyOptional()
  bio: string | null;

  @ApiPropertyOptional()
  tagline: string | null;

  @ApiPropertyOptional({ type: [String] })
  specialties: string[] | null;

  @ApiPropertyOptional()
  experienceYears: number | null;

  @ApiPropertyOptional({ type: [Object] })
  certifications: { name: string; issuer?: string; year?: number }[] | null;

  @ApiPropertyOptional()
  websiteUrl: string | null;

  @ApiPropertyOptional({ type: [Object] })
  socialLinks: { label: string; url: string }[] | null;

  @ApiProperty({ example: 4.8 })
  averageRating: number;

  @ApiProperty({ example: 42 })
  ratingCount: number;
}
