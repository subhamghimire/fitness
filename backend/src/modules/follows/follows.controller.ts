import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { FollowListQueryDto, FollowListResponseDto, FollowStateResponseDto } from "./dto";
import { FollowsService } from "./follows.service";

/**
 * FOLLOWS HTTP API
 * ---------------------------------------------------------------------------
 * `/social/users/:userId/follow`. The `:userId` is always the *target*, never
 * the caller — a client that has to guess which side of the edge it is asking
 * about is a client that gets the button state wrong.
 *
 * Every handler here is authenticated, and all authorisation is the service's
 * job (existence, block state, duplicate detection). The guard only establishes
 * *who* is calling.
 *
 * The `@Throttle` decorators are the in-process half of abuse protection; the
 * shared, cross-instance quota that actually bounds follow spam lives in
 * `SocialRateLimiter` and is enforced by the service. See
 * `SOCIAL_RATE_LIMITS` for why both exist.
 */
@ApiTags("Social — follows")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social/users")
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post(":userId/follow")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "Follow a user", description: "409 when the edge already exists or the pair is blocked in either direction." })
  @ApiResponse({ status: 201, type: FollowStateResponseDto })
  @ApiResponse({ status: 400, description: "Self-follow" })
  @ApiResponse({ status: 404, description: "No such (live) user" })
  @ApiResponse({ status: 409, description: "Already following, or blocked in either direction" })
  @ApiResponse({ status: 429, description: "Follow quota exhausted" })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  follow(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string): Promise<FollowStateResponseDto> {
    return this.followsService.follow(user.id, userId);
  }

  @Delete(":userId/follow")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "Unfollow a user (idempotent)" })
  @ApiResponse({ status: 200, type: FollowStateResponseDto })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  unfollow(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string): Promise<FollowStateResponseDto> {
    return this.followsService.unfollow(user.id, userId);
  }

  @Get(":userId/follow")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "The caller's relationship with a user, plus that user's follower/following counts" })
  @ApiResponse({ status: 200, type: FollowStateResponseDto })
  @ApiResponse({ status: 404, description: "No such (live) user" })
  getState(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string): Promise<FollowStateResponseDto> {
    return this.followsService.getState(user.id, userId);
  }

  @Get(":userId/followers")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "Who follows this user, newest first (cursor-paginated)" })
  @ApiResponse({ status: 200, type: FollowListResponseDto })
  listFollowers(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string, @Query() query: FollowListQueryDto): Promise<FollowListResponseDto> {
    return this.followsService.listFollowers(userId, query);
  }

  @Get(":userId/following")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "Who this user follows, most recent first (cursor-paginated)" })
  @ApiResponse({ status: 200, type: FollowListResponseDto })
  listFollowing(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string, @Query() query: FollowListQueryDto): Promise<FollowListResponseDto> {
    return this.followsService.listFollowing(userId, query);
  }
}
