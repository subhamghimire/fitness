import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedResponseDto, PaginationMeta } from "src/common/dto";
import { CoachDocumentStatus, CoachDocumentType } from "../enums";

export class CoachDocumentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  coachId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: CoachDocumentType })
  type: CoachDocumentType;

  @ApiPropertyOptional({ format: "uuid", description: "Reference to a Files module record (binary is never stored in the DB)" })
  fileId: string | null;

  @ApiProperty({ enum: CoachDocumentStatus })
  status: CoachDocumentStatus;

  @ApiPropertyOptional({ type: [String] })
  badges: string[] | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedCoachDocumentResponseDto extends PaginatedResponseDto<CoachDocumentResponseDto> {
  @ApiProperty({ type: [CoachDocumentResponseDto] })
  declare data: CoachDocumentResponseDto[];

  @ApiProperty({ type: PaginationMeta })
  declare pagination: PaginationMeta;
}
