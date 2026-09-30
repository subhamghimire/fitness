import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from "class-validator";
import { CursorQueryDto } from "src/common/dto";
import { SOCIAL_CONTENT_LIMITS } from "src/common/social";
import { PostPrivacy, PostType } from "../enums";

/**
 * `POST /social/posts`
 *
 * Validation is expressed as *field groups that are only valid together*: the
 * class-validator cross-field rules below are the first of three layers that
 * enforce "a post's type agrees with its reference", and the other two are the
 * service (ownership of the referenced row) and a database CHECK. Each layer
 * catches a different class of mistake — a malformed request, a request naming
 * someone else's workout, and a row that somehow got written anyway.
 */
export class CreatePostDto {
  @ApiProperty({ enum: PostType, default: PostType.TEXT })
  @IsEnum(PostType)
  type: PostType = PostType.TEXT;

  @ApiPropertyOptional({ maxLength: SOCIAL_CONTENT_LIMITS.POST_BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SOCIAL_CONTENT_LIMITS.POST_BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ enum: PostPrivacy, default: PostPrivacy.PUBLIC })
  @IsOptional()
  @IsEnum(PostPrivacy)
  privacy?: PostPrivacy = PostPrivacy.PUBLIC;

  @ApiPropertyOptional({ format: "uuid", description: "Required when type is WORKOUT_SHARE. Must be a workout you own." })
  @ValidateIf((dto: CreatePostDto) => dto.type === PostType.WORKOUT_SHARE)
  @IsUUID()
  workoutId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Required when type is TEMPLATE_SHARE. Must be a template you own." })
  @ValidateIf((dto: CreatePostDto) => dto.type === PostType.TEMPLATE_SHARE)
  @IsUUID()
  workoutTemplateId?: string;
}

/**
 * `PATCH /social/posts/:id`
 *
 * Only the *content* of a post is mutable. `type` and the references are not
 * accepted here at all — see the comment on `PostType` for why: retyping a post
 * would have to re-validate every consistency rule and would silently break the
 * "one live share per workout" guarantee.
 *
 * `body` may be cleared to `null` for a share post (a caption is optional) but
 * not for a text post; that is the one cross-field rule on this DTO, and it is
 * enforced again in the service.
 */
export class UpdatePostDto {
  @ApiPropertyOptional({ maxLength: SOCIAL_CONTENT_LIMITS.POST_BODY_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SOCIAL_CONTENT_LIMITS.POST_BODY_MAX_LENGTH)
  body?: string | null;

  @ApiPropertyOptional({ enum: PostPrivacy })
  @IsOptional()
  @IsEnum(PostPrivacy)
  privacy?: PostPrivacy;
}

/**
 * `GET /social/users/:userId/posts` — one author's visible posts.
 *
 * Extends the shared cursor base rather than the page-based `PaginationQueryDto`:
 * a profile's post list grows without bound and is read while new posts arrive,
 * which is precisely the case `common/social/social-cursor.ts` explains.
 */
export class PostQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: PostType, description: "Restrict to one post type" })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;
}

/**
 * `GET /social/posts` — the public timeline of everything visible to the caller.
 *
 * `authorId` here is a *filter*, not a scope: the visibility rules are applied
 * on top of it, so this endpoint can never be used to read a private profile.
 * (The per-author list is a separate route so the two intents cannot be confused
 * by a client that forgets a filter.)
 */
export class PostFeedQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ format: "uuid", description: "Restrict to one author" })
  @IsOptional()
  @IsUUID()
  authorId?: string;

  @ApiPropertyOptional({ enum: PostType, description: "Restrict to one post type" })
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;
}
