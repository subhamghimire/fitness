import { Body, Controller, Delete, Param, ParseUUIDPipe, Post as HttpPost, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { LikeResultDto, LikeStateRequestDto, LikeStateResponseDto } from "./dto";
import { LikesService } from "./likes.service";

/**
 * LIKES HTTP API
 * ---------------------------------------------------------------------------
 * `/social/posts/:postId/like` for the toggle, `/social/likes/state` for the
 * batch read a feed needs.
 *
 * The two are separate routes rather than one overloaded endpoint because they
 * answer different questions and have different shapes: the toggle is a write
 * with a counter in its response, the state read is a batch query over a page of
 * ids. Folding them together would mean a POST that sometimes means "toggle"
 * and sometimes means "tell me", which is how a double-tap becomes an unlike.
 *
 * `like` is a 409 on a repeat and `unlike` is idempotent — that asymmetry is
 * deliberate and documented in `LikesService`. A client should treat a 409 from
 * `like` as success: the state it asked for is true.
 */
@ApiTags("Social — likes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social")
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @HttpPost("posts/:postId/like")
  @ApiParam({ name: "postId" })
  @ApiOperation({ summary: "Like a post", description: "409 when already liked. Unlike is idempotent — see the two are deliberately different." })
  @ApiResponse({ status: 201, type: LikeResultDto })
  @ApiResponse({ status: 404, description: "Missing, deleted, or not visible to the caller" })
  @ApiResponse({ status: 409, description: "Already liked" })
  @ApiResponse({ status: 429, description: "Like quota exhausted" })
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  like(@CurrentUser() user: User, @Param("postId", ParseUUIDPipe) postId: string): Promise<LikeResultDto> {
    return this.likesService.like(user.id, postId);
  }

  @Delete("posts/:postId/like")
  @ApiParam({ name: "postId" })
  @ApiOperation({ summary: "Unlike a post (idempotent)" })
  @ApiResponse({ status: 200, type: LikeResultDto })
  @ApiResponse({ status: 404, description: "Missing, deleted, or not visible to the caller" })
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  unlike(@CurrentUser() user: User, @Param("postId", ParseUUIDPipe) postId: string): Promise<LikeResultDto> {
    return this.likesService.unlike(user.id, postId);
  }

  @HttpPost("likes/state")
  @ApiOperation({
    summary: "Which of these posts the caller has liked",
    description: "Takes a whole page of ids so a feed needs one extra request per page, not one per post. Capped at 50 ids."
  })
  @ApiResponse({ status: 201, type: LikeStateResponseDto })
  @ApiResponse({ status: 400, description: "More than 50 ids, or a malformed uuid" })
  likeState(@CurrentUser() user: User, @Body() dto: LikeStateRequestDto): Promise<LikeStateResponseDto> {
    return this.likesService.stateFor(user.id, dto);
  }
}
