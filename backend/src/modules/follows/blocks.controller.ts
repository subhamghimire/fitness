import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { BlockListQueryDto, BlockListResponseDto, BlockedUserResponseDto, CreateBlockDto } from "./dto";
import { BlocksService } from "./blocks.service";

/**
 * BLOCKS HTTP API
 * ---------------------------------------------------------------------------
 * `/social/users/:userId/block`. Mounted on the same path shape as the follow
 * routes because a block and a follow are two ends of the same edge — a client
 * rendering a profile needs both from the same `:userId`.
 *
 * The block list is visible to the blocker only and is never shared with the
 * blocked user; there is deliberately no "did they block me?" endpoint, because
 * it leaks that a specific account exists *and* that it engaged with you, which
 * is exactly the signal someone enumerating accounts wants. The only trace of a
 * block on the other side is its effect: a follow is refused and content
 * disappears.
 */
@ApiTags("Social — blocks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social")
export class BlocksController {
  constructor(private readonly blocksService: BlocksService) {}

  @Post("users/:userId/block")
  @ApiParam({ name: "userId" })
  @ApiOperation({
    summary: "Block a user",
    description: "Mutual, and destructive to the follow graph: follow edges in both directions are removed. Content is not deleted."
  })
  @ApiResponse({ status: 201, type: BlockedUserResponseDto })
  @ApiResponse({ status: 400, description: "Self-block" })
  @ApiResponse({ status: 404, description: "No such (live) user" })
  @ApiResponse({ status: 409, description: "Already blocked" })
  @ApiResponse({ status: 429, description: "Block quota exhausted" })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  block(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string, @Body() dto: CreateBlockDto): Promise<BlockedUserResponseDto> {
    return this.blocksService.block(user.id, userId, dto);
  }

  @Delete("users/:userId/block")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "Unblock a user (idempotent). Does not restore follow edges." })
  @ApiResponse({ status: 200 })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async unblock(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string): Promise<{ unblocked: true }> {
    return this.blocksService.unblock(user.id, userId);
  }

  @Get("blocks")
  @ApiOperation({ summary: "Who I have blocked, newest first (cursor-paginated)" })
  @ApiResponse({ status: 200, type: BlockListResponseDto })
  listBlocked(@CurrentUser() user: User, @Query() query: BlockListQueryDto): Promise<BlockListResponseDto> {
    return this.blocksService.listBlocked(user.id, query);
  }
}
