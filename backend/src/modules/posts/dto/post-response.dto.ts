import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CursorPageMetaDto } from "src/common/dto";
import { SocialUserSummaryDto } from "src/shared/social/social-user-presenter.service";
import { PostPrivacy, PostType } from "../enums";

/**
 * A workout as it appears *inside* a post.
 *
 * A deliberately thin projection: a shared post renders a card (name, when, how
 * long), and copying the whole workout graph into a social payload would leak
 * the owner's notes and re-expose a workout the owner later deleted from view.
 * `GET /workouts/:id` remains the authority for the full record.
 */
export class PostWorkoutRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true, description: "ISO timestamp the workout started" })
  startedAt: Date | null;

  @ApiProperty({ nullable: true })
  durationSeconds: number | null;
}

export class PostTemplateRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

/**
 * The caller's relationship to a post.
 *
 * Note what is *absent*: `liked`. Filling it in here would make PostsModule read
 * the `likes` table, and since `LikesService` owns the counter updates and must
 * import PostsModule to bump them, that would close a module cycle. The liked
 * state is instead one batched call owned by LikesModule
 * (`POST /social/likes/state`, which takes a whole page of post ids), so a client
 * still needs exactly one extra request per page rather than one per post.
 */
export class PostViewerStateDto {
  @ApiProperty({ description: "The caller is the author" })
  isAuthor: boolean;
}

export class PostResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: PostType })
  type: PostType;

  @ApiProperty({ enum: PostPrivacy })
  privacy: PostPrivacy;

  @ApiProperty({ nullable: true })
  body: string | null;

  @ApiProperty({ type: SocialUserSummaryDto })
  author: SocialUserSummaryDto;

  @ApiProperty({ nullable: true, description: "Populated for WORKOUT_SHARE when the referenced workout still exists" })
  workout: PostWorkoutRefDto | null;

  @ApiProperty({ nullable: true, description: "Populated for TEMPLATE_SHARE when the referenced template still exists" })
  workoutTemplate: PostTemplateRefDto | null;

  @ApiProperty({ example: 0 })
  likeCount: number;

  @ApiProperty({ example: 0 })
  commentCount: number;

  @ApiProperty({ type: PostViewerStateDto })
  viewer: PostViewerStateDto;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ description: "Only on posts the caller authored" })
  updatedAt?: Date;
}

export class PostPageResponseDto {
  @ApiProperty({ type: [PostResponseDto] })
  data: PostResponseDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}
