import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CoachVerificationStatus } from "../enums";

export class CoachVerificationResponseDto {
  @ApiProperty()
  coachId: string;

  @ApiProperty({ enum: CoachVerificationStatus })
  status: CoachVerificationStatus;

  @ApiPropertyOptional()
  submittedAt: Date | null;

  @ApiPropertyOptional()
  reviewedAt: Date | null;

  @ApiPropertyOptional({ format: "uuid" })
  reviewedBy: string | null;

  @ApiPropertyOptional()
  decisionNote: string | null;

  @ApiPropertyOptional()
  expiresAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
