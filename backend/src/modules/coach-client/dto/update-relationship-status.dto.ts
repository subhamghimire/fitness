import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { RelationshipStatus } from "../enums";

export class UpdateRelationshipStatusDto {
  @ApiProperty({ enum: RelationshipStatus, description: "Target status for the relationship" })
  @IsEnum(RelationshipStatus)
  status: RelationshipStatus;
}
