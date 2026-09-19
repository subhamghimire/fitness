import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";
import { CoachAccountStatus, CoachEligibility, CoachVerificationStatus } from "../enums";
import { PublicCoachProfileDto, CoachProfileResponseDto } from "src/modules/coach-profile/dto";
import { CoachVerificationResponseDto } from "src/modules/coach-verification/dto";

export class CoachResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id: string;

  @ApiProperty({ example: "John Smith" })
  name: string;

  @ApiProperty({ enum: CoachVerificationStatus })
  verificationStatus: CoachVerificationStatus;

  @ApiProperty({ enum: CoachAccountStatus })
  accountStatus: CoachAccountStatus;

  @ApiProperty({ enum: CoachEligibility })
  eligibility: CoachEligibility;

  @ApiProperty({ example: 0 })
  rank: number;

  @ApiPropertyOptional({ type: CoachProfileResponseDto })
  profile?: CoachProfileResponseDto;

  @ApiPropertyOptional({ type: CoachVerificationResponseDto })
  coachVerification?: CoachVerificationResponseDto;

  @ApiPropertyOptional({ description: "Number of approved documents" })
  documentCount?: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PublicCoachResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id: string;

  @ApiProperty({ example: "John Smith" })
  name: string;

  @ApiProperty({ enum: CoachVerificationStatus, example: CoachVerificationStatus.VERIFIED })
  verificationStatus: CoachVerificationStatus;

  @ApiProperty({ example: 0 })
  rank: number;

  @ApiPropertyOptional({ type: PublicCoachProfileDto })
  profile?: PublicCoachProfileDto | null;

  @ApiPropertyOptional({ description: "Number of approved documents" })
  documentCount?: number;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedCoachResponseDto extends PaginatedResponseDto<PublicCoachResponseDto> {
  @ApiProperty({ type: [PublicCoachResponseDto] })
  declare data: PublicCoachResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
