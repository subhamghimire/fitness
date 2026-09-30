import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { SOCIAL_PAGE_LIMITS } from "../social/social.constants";

/**
 * Base query for every cursor-paginated social list.
 *
 * Note there is no `page` here on purpose — see `common/social/social-cursor.ts`
 * for why these lists are keyset-paginated instead.
 */
export class CursorQueryDto {
  @ApiPropertyOptional({ description: "Opaque cursor from a previous page's `nextCursor`" })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: SOCIAL_PAGE_LIMITS.defaultLimit, minimum: 1, maximum: SOCIAL_PAGE_LIMITS.maxLimit })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SOCIAL_PAGE_LIMITS.maxLimit)
  limit: number = SOCIAL_PAGE_LIMITS.defaultLimit;
}

/** Generic cursor page envelope. Mirrors `PaginatedResponseDto` without the total count. */
export class CursorPageMetaDto {
  @ApiProperty({ nullable: true, description: "Cursor to pass as `?cursor=` for the next page; null when the last page has been reached" })
  nextCursor: string | null;

  @ApiProperty({ example: true })
  hasMore: boolean;
}

export class CursorPageResponseDto<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}
