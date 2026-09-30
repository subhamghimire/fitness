import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { CursorPageMetaDto, CursorQueryDto } from "src/common/dto";
import { PostResponseDto } from "src/modules/posts/dto";
import { DEFAULT_FEED_SCOPE, FEED_SCOPES, FeedScope } from "../enums";

/**
 * `GET /social/feed`
 *
 * `scope` and `strategy` are orthogonal on purpose: scope decides *which* posts
 * are candidates, strategy decides the *order*. Keeping them separate is what lets
 * a client ask for "everything, hottest first" and "the people I follow, newest
 * first" without a combinatorial list of named feeds, and it is what lets a new
 * ranking ship without touching any scope.
 *
 * `strategy` is validated against the registry rather than an enum in this file.
 * That is deliberate: the set of rankings is a runtime registration, so the DTO
 * states the *shape* of the parameter and `FeedRankingRegistry` answers whether
 * the value is one of the implemented ones — with the valid set in the error.
 */
export class FeedQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    enum: FEED_SCOPES,
    default: DEFAULT_FEED_SCOPE,
    description:
      "Which posts are candidates. `following` is the everyday feed and includes the viewer's own posts; `discover` is the whole visible public timeline; `latest` is the same set as `discover` under a different default ranking."
  })
  @IsOptional()
  @IsEnum(FeedScope)
  scope: FeedScope = DEFAULT_FEED_SCOPE;

  @ApiPropertyOptional({ enum: ["recent", "hot"], default: "recent", description: "The ordering. Resolved by the ranking registry, so this list grows without an API change." })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  strategy?: string;

  @ApiPropertyOptional({ description: "Only posts of this type" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string;

  @ApiPropertyOptional({ description: "Only posts written on this date (UTC day). Bounds the query instead of filtering in application memory." })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  before?: string;
}

export class FeedPageResponseDto {
  @ApiProperty({ type: [PostResponseDto] })
  data: PostResponseDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;

  @ApiProperty({ description: "The scope that produced this page, echoed so a client caching per scope cannot mix them up" })
  scope: FeedScope;

  @ApiProperty({ description: "The ranking that ordered this page, echoed for the same reason" })
  strategy: string;
}
