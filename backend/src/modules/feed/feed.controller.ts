import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { FeedPageResponseDto, FeedQueryDto } from "./dto";
import { FeedRankingRegistry } from "./feed-ranking";
import { FeedService } from "./feed.service";

/**
 * FEED HTTP API
 * ---------------------------------------------------------------------------
 * One route. The variety is in the query, not in the path: `/social/feed`,
 * `/social/feed?scope=discover`, `/social/feed?strategy=hot`.
 *
 * ─── Why one route and not `/social/feed/:scope/:strategy` ──────────────────
 * Two reasons, and the second is the important one.
 *
 *   1. The parameters are optional and independent, so a path-shaped URL would
 *      have to invent a default segment for "the caller did not choose" and
 *      would produce four URLs for the same page.
 *   2. **The cursor is a query parameter.** If the path named the scope and the
 *      strategy, a client paging through a feed would have to rebuild the path on
 *      every request, and the strategy — which is embedded in the cursor and
 *      validated against it — becomes a place where two sources of truth (the
 *      path and the cursor) can disagree. Keeping both in the query string means
 *      there is exactly one place the ordering is named, and it is validated
 *      there.
 *
 * `GET /social/feed/strategies` is discoverability, not a feed: a client
 * integrating this needs to know which rankings exist, and the set is a runtime
 * registration rather than an enum.
 */
@ApiTags("Social — feed")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social/feed")
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly rankings: FeedRankingRegistry
  ) {}

  @Get()
  @ApiOperation({
    summary: "One page of a feed",
    description:
      "Cursor-paginated. `scope` picks the candidate set, `strategy` picks the ordering, and a cursor minted under a different pair is rejected with a 400 so a client that switches mid-pagination restarts instead of receiving a scrambled page."
  })
  @ApiResponse({ status: 200, type: FeedPageResponseDto })
  @ApiResponse({ status: 400, description: "Malformed cursor, or an unknown strategy (the valid set is named in the message)" })
  getFeed(@CurrentUser() user: User, @Query() query: FeedQueryDto): Promise<FeedPageResponseDto> {
    return this.feedService.getFeed(user.id, query);
  }

  @Get("strategies")
  @ApiOperation({ summary: "The ranking strategies this build supports", description: "Discoverability only — this does not read any feed data." })
  @ApiResponse({ status: 200, schema: { type: "array", items: { type: "object", properties: { id: { type: "string", example: "recent" }, description: { type: "string" } } } } })
  listStrategies(): { id: string; description: string }[] {
    return this.rankings.list().map((strategy) => ({ id: strategy.id, description: strategy.description }));
  }
}
