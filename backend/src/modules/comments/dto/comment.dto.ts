import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { CursorPageMetaDto, CursorQueryDto } from "src/common/dto";
import { SOCIAL_CONTENT_LIMITS } from "src/common/social";
import { SocialUserSummaryDto } from "src/shared/social/social-user-presenter.service";

/** The two thread orderings, stated once so the DTO and the service agree. */
export const COMMENT_SORTS = ["top", "recent"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

/**
 * `POST /social/posts/:postId/comments`
 *
 * `parentId` turns a create into a reply. It is optional here and validated for
 * existence, ownership-of-context and depth in the service: `class-validator`
 * can check that it is a uuid, but only the service knows whether that comment
 * is a *top-level comment on the same post*, which is the rule that keeps the
 * thread one level deep.
 *
 * `MinLength(1)` plus the service's whitespace normalisation means an empty
 * comment is refused at the edge rather than becoming a blank row that has to be
 * filtered on every read.
 */
export class CreateCommentDto {
  @ApiProperty({ maxLength: SOCIAL_CONTENT_LIMITS.COMMENT_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(SOCIAL_CONTENT_LIMITS.COMMENT_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "Reply to this top-level comment. Must belong to the same post and must itself be top-level." })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

/**
 * `PATCH /social/comments/:id`
 *
 * Body only. Reparenting a comment would change the shape of a thread other
 * people are reading, and it would make `depth` and `parent_id` disagreeable —
 * so it is not accepted here at all.
 */
export class UpdateCommentDto {
  @ApiPropertyOptional({ maxLength: SOCIAL_CONTENT_LIMITS.COMMENT_BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SOCIAL_CONTENT_LIMITS.COMMENT_BODY_MAX_LENGTH)
  body?: string;
}

/**
 * `GET /social/posts/:postId/comments`
 *
 * `sort=top` returns top-level comments with their replies nested;
 * `sort=recent` (the default) returns one flat, strictly chronological list of
 * every comment on the post. Two orderings, both keyset-paginated, because they
 * are genuinely different reads and pretending otherwise produces a page that
 * mixes the two.
 */
export class CommentQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: COMMENT_SORTS, default: "recent" })
  @IsOptional()
  @IsIn(COMMENT_SORTS)
  sort: CommentSort = "recent";

  @ApiPropertyOptional({ format: "uuid", description: "Replies to this comment only" })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

/**
 * The caller's relationship to a comment.
 *
 * `canModify` is derived from `isAuthor` in the service rather than being checked
 * independently, so a client can never be told it may edit a comment and then be
 * refused by the write path.
 */
export class PostViewerStateDto {
  @ApiProperty({ description: "The caller wrote this comment" })
  isAuthor: boolean;

  @ApiProperty({ description: "The caller may edit or delete it (i.e. is the author, and it is not already deleted)" })
  canModify: boolean;
}

/** A single comment. */
export class CommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  postId: string;

  @ApiProperty({ type: SocialUserSummaryDto })
  author: SocialUserSummaryDto;

  @ApiProperty()
  body: string;

  @ApiProperty({ nullable: true, description: "The top-level comment this replies to" })
  parentId: string | null;

  @ApiProperty({ enum: [0, 1], description: "0 = top-level, 1 = reply" })
  depth: number;

  @ApiProperty({ description: "Live replies to this comment. Always 0 on a reply." })
  replyCount: number;

  @ApiProperty({ type: PostViewerStateDto, description: "The caller's relationship to this comment" })
  viewer: PostViewerStateDto;
  @ApiProperty({ description: "The comment was soft-deleted and renders as a tombstone" })
  isDeleted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

/** A comment plus, for `sort=top`, its replies. */
export class CommentThreadItemDto extends CommentResponseDto {
  @ApiProperty({ type: [CommentResponseDto] })
  replies: CommentResponseDto[];
}

export class CommentPageResponseDto {
  @ApiProperty({ type: [CommentThreadItemDto] })
  data: CommentThreadItemDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}
