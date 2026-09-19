import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { RelationshipStatus } from "../enums";
import { ProgressOverviewResponseDto } from "src/modules/progress/dto/progress-response.dto";

export class CoachBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: "Owning user id" })
  userId: string;
}

export class ClientBriefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

export class CoachClientRelationshipResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RelationshipStatus })
  status: RelationshipStatus;

  @ApiPropertyOptional()
  startedAt: Date | null;

  @ApiPropertyOptional()
  endedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: CoachBriefDto })
  coach: CoachBriefDto;

  @ApiProperty({ type: ClientBriefDto })
  client: ClientBriefDto;
}

export class ClientInvitationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RelationshipStatus })
  status: RelationshipStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: CoachBriefDto })
  coach: CoachBriefDto;
}

export class ClientCoachResponseDto {
  @ApiProperty({ type: CoachClientRelationshipResponseDto })
  relationship: CoachClientRelationshipResponseDto;

  @ApiProperty({ type: CoachBriefDto })
  coach: CoachBriefDto;
}

export class CoachClientProgressResponseDto {
  @ApiProperty({ description: "Relationship the progress belongs to" })
  relationshipId: string;

  @ApiProperty({ description: "Client whose progress is being shared" })
  clientId: string;

  @ApiProperty({ type: ProgressOverviewResponseDto })
  overview: ProgressOverviewResponseDto;
}
