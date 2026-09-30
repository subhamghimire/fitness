import { ApiProperty } from "@nestjs/swagger";
import { CursorPageMetaDto, CursorQueryDto } from "src/common/dto";
import { BlockReason } from "../enums";
import { SocialUserSummaryDto } from "src/shared/social/social-user-presenter.service";

/** Cursor for the block list. Same ordering contract as the follow lists. */
export class BlockListQueryDto extends CursorQueryDto {}

export class BlockedUserResponseDto extends SocialUserSummaryDto {
  @ApiProperty({ description: "When the block was created" })
  blockedAt: Date;

  @ApiProperty({ enum: BlockReason, nullable: true, description: "Coarse, blocker-private. Never used for enforcement." })
  reason: BlockReason | null;

  @ApiProperty({ maxLength: 200, nullable: true })
  note: string | null;
}

export class BlockListResponseDto {
  @ApiProperty({ type: [BlockedUserResponseDto] })
  data: BlockedUserResponseDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}
