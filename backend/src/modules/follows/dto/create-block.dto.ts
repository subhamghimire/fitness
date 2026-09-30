import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { BlockReason } from "../enums";

/**
 * `POST /social/blocks/:userId`
 *
 * The reason is optional and coarse. It is recorded for the blocker's own
 * bookkeeping only — nothing in the product branches on it.
 */
export class CreateBlockDto {
  @ApiPropertyOptional({ enum: BlockReason, description: "Optional, for the blocker's own records. Never used for enforcement." })
  @IsOptional()
  @IsEnum(BlockReason)
  reason?: BlockReason;

  @ApiPropertyOptional({ maxLength: 200, description: "Optional private note" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
