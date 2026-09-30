import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { CreatePostDto, PostFeedQueryDto, PostPageResponseDto, PostQueryDto, PostResponseDto, UpdatePostDto } from "./dto";
import { PostsService } from "./posts.service";

/**
 * POSTS HTTP API
 * ---------------------------------------------------------------------------
 * `/social/posts` for the timeline and the public listing,
 * `/social/users/:userId/posts` for one author's profile. Split into two routes
 * rather than one route with an `authorId` filter, because "a feed" and "this
 * profile" are different intents: the profile is a complete, finite history the
 * client can page to the end, while the timeline is a live window. A single
 * endpoint with an optional filter makes a client that forgets the filter
 * silently render somebody's entire history as a global feed.
 *
 * The guard only establishes *who* is calling. Every authorisation decision —
 * ownership for edits, visibility for reads, the follow/block exclusions — lives
 * in the services, where it can be reasoned about and tested without HTTP.
 *
 * Reads are **not** throttled beyond the global 60/min: browsing a profile is the
 * cheapest thing a client can do here, and a feed product that 429s a scroll is a
 * feed product people stop opening. The expensive, abusable direction (creating
 * content) is bounded twice — by the in-process `@Throttle` below and by the
 * shared, cross-instance quota in `SocialRateLimiter`.
 */
@ApiTags("Social — posts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social")
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post("posts")
  @ApiOperation({
    summary: "Create a post",
    description: "Sharing a workout or a template is a reference, not a copy: the referenced row must exist and be owned by the author. One live share per workout per author."
  })
  @ApiResponse({ status: 201, type: PostResponseDto })
  @ApiResponse({ status: 400, description: "Type/reference disagreement, or a missing body for a text post" })
  @ApiResponse({ status: 403, description: "Referenced row belongs to someone else, or a coach-content post from a non-coach" })
  @ApiResponse({ status: 404, description: "Referenced workout or template not found" })
  @ApiResponse({ status: 409, description: "This workout is already shared in a live post" })
  @ApiResponse({ status: 429, description: "Post quota exhausted" })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  create(@CurrentUser() user: User, @Body() dto: CreatePostDto): Promise<PostResponseDto> {
    return this.postsService.create(user.id, dto);
  }

  @Get("posts")
  @ApiOperation({ summary: "Every post visible to the caller, newest first", description: "Visibility-filtered; `authorId` here is a filter, not a scope." })
  @ApiResponse({ status: 200, type: PostPageResponseDto })
  listVisible(@CurrentUser() user: User, @Query() query: PostFeedQueryDto): Promise<PostPageResponseDto> {
    return this.postsService.listVisible(user.id, query);
  }

  @Get("posts/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "One post", description: "404 for a post that exists but is not visible to the caller, so the id space is not an existence oracle." })
  @ApiResponse({ status: 200, type: PostResponseDto })
  @ApiResponse({ status: 404, description: "Missing, deleted, or not visible" })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<PostResponseDto> {
    return this.postsService.getOne(user.id, id);
  }

  @Patch("posts/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({
    summary: "Edit a post (author only)",
    description: "Body and privacy only: the type and the referenced workout/template are immutable, and are not accepted by the DTO."
  })
  @ApiResponse({ status: 200, type: PostResponseDto })
  @ApiResponse({ status: 400, description: "A body is required for this post type" })
  @ApiResponse({ status: 404, description: "No such post of yours" })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto): Promise<PostResponseDto> {
    return this.postsService.update(user.id, id, dto);
  }

  @Delete("posts/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({
    summary: "Soft-delete a post (author only, idempotent)",
    description: "The row survives so an open comment thread does not collapse and an existing report stays resolvable."
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No such post of yours" })
  remove(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.postsService.remove(user.id, id);
  }

  @Get("users/:userId/posts")
  @ApiParam({ name: "userId" })
  @ApiOperation({ summary: "One author's posts visible to the caller, newest first (cursor-paginated)" })
  @ApiResponse({ status: 200, type: PostPageResponseDto })
  @ApiResponse({ status: 404, description: "No such (live) user" })
  listByAuthor(@CurrentUser() user: User, @Param("userId", ParseUUIDPipe) userId: string, @Query() query: PostQueryDto): Promise<PostPageResponseDto> {
    return this.postsService.listByAuthor(user.id, userId, query);
  }
}
