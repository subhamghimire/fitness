import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { User } from "src/modules/users/entities/user.entity";
import { CommentPageResponseDto, CommentQueryDto, CommentResponseDto, CreateCommentDto, UpdateCommentDto } from "./dto";
import { CommentsService } from "./comments.service";

/**
 * COMMENTS HTTP API
 * ---------------------------------------------------------------------------
 * `/social/posts/:postId/comments` for the thread, `/social/comments/:id` for a
 * single comment. The thread is nested under the post for the same reason posts
 * are addressed by author in a separate route: a comment is only ever read in
 * the context of the thing it is about, and putting `postId` in the path makes
 * it impossible to ask for a thread without also proving which post it is.
 *
 * A soft-deleted comment is returned as a tombstone (`isDeleted: true`, empty
 * body) rather than as a 404, so a thread keeps its shape. The one exception is
 * a comment the caller did not write: they get a 404, because a deleted comment
 * should not be a place where a stranger can confirm that a particular person
 * said something on a given post.
 */
@ApiTags("Social — comments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("social")
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post("posts/:postId/comments")
  @ApiParam({ name: "postId" })
  @ApiOperation({
    summary: "Comment on a post, or reply to a top-level comment",
    description: "The thread is one level deep: `parentId` must name a top-level comment on the same post. An identical resubmission of the same body is a 409."
  })
  @ApiResponse({ status: 201, type: CommentResponseDto })
  @ApiResponse({ status: 400, description: "Empty body" })
  @ApiResponse({ status: 404, description: "Post or parent comment missing, or the post is not visible" })
  @ApiResponse({ status: 409, description: "Duplicate comment body on the same post" })
  @ApiResponse({ status: 429, description: "Comment quota exhausted" })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  create(@CurrentUser() user: User, @Param("postId", ParseUUIDPipe) postId: string, @Body() dto: CreateCommentDto): Promise<CommentResponseDto> {
    return this.commentsService.create(user.id, postId, dto);
  }

  @Get("posts/:postId/comments")
  @ApiParam({ name: "postId" })
  @ApiOperation({
    summary: "A post's comments (cursor-paginated)",
    description: "`sort=recent` is one flat chronological list; `sort=top` is top-level comments with replies nested. Pass `parentId` to page a single conversation."
  })
  @ApiResponse({ status: 200, type: CommentPageResponseDto })
  @ApiResponse({ status: 400, description: "Malformed cursor" })
  @ApiResponse({ status: 404, description: "Post missing, or not visible to the caller" })
  list(@CurrentUser() user: User, @Param("postId", ParseUUIDPipe) postId: string, @Query() query: CommentQueryDto): Promise<CommentPageResponseDto> {
    return this.commentsService.list(user.id, postId, query);
  }

  @Get("comments/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "One comment" })
  @ApiResponse({ status: 200, type: CommentResponseDto })
  @ApiResponse({ status: 404, description: "Missing, deleted-and-not-yours, or on a post you cannot see" })
  getOne(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<CommentResponseDto> {
    return this.commentsService.getOne(user.id, id);
  }

  @Patch("comments/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({ summary: "Edit a comment (author only)", description: "Body only — a comment cannot be reparented out of a thread other people are reading." })
  @ApiResponse({ status: 200, type: CommentResponseDto })
  @ApiResponse({ status: 400, description: "Empty body" })
  @ApiResponse({ status: 404, description: "No such comment of yours" })
  @ApiResponse({ status: 409, description: "Identical to another of your live comments on the same post" })
  update(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCommentDto): Promise<CommentResponseDto> {
    return this.commentsService.update(user.id, id, dto);
  }

  @Delete("comments/:id")
  @ApiParam({ name: "id" })
  @ApiOperation({
    summary: "Soft-delete a comment (author only, idempotent)",
    description: "Replies are kept: the thread becomes a tombstone with its replies intact, rather than a set of context-free quotes."
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No such comment of yours" })
  remove(@CurrentUser() user: User, @Param("id", ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.commentsService.remove(user.id, id);
  }
}
