import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { RelationshipStatus } from "../enums";

export class CoachClientQueryDto {
  @ApiPropertyOptional({ enum: RelationshipStatus, description: "Filter relationships by status" })
  @IsOptional()
  @IsEnum(RelationshipStatus)
  status?: RelationshipStatus;
}
