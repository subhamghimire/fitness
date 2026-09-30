import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from "class-validator";

/**
 * `POST /social/likes/state`
 *
 * The batch "which of these posts have I liked?" read.
 *
 * ─── Why this exists instead of a `liked` flag on every post response ────────
 * Putting the viewer's liked state in `PostResponseDto` would force `PostsModule`
 * to read `post_likes`, and since `LikesModule` must import `PostsModule` to move
 * the counter, that would close a module cycle. So the state is answered here,
 * from the module that owns the rows — and it takes a *whole page* of post ids in
 * one request, which is what keeps a feed at one extra request per page instead
 * of one per post.
 *
 * `ArrayUnique` + `ArrayMaxSize` are the abuse guard on this endpoint. Without
 * them it is the one read in the social platform whose cost is controlled by the
 * *client* rather than by the page size: a caller could post 50 000 ids and turn
 * a cheap `IN` list into a scan. The cap is `SOCIAL_PAGE_LIMITS.maxLimit` (50),
 * so a request can never ask about more posts than a single page can return.
 */
export class LikeStateRequestDto {
  @ApiProperty({ type: [String], format: "uuid", maxItems: 50, description: "Post ids from the page the client is rendering" })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID("4", { each: true })
  postIds: string[];
}

export class PostLikeStateDto {
  @ApiProperty({ format: "uuid" })
  postId: string;

  @ApiProperty({ description: "The caller has a live like on this post" })
  liked: boolean;
}

export class LikeStateResponseDto {
  @ApiProperty({
    type: [PostLikeStateDto],
    description: "One entry per requested id, in the order requested. Ids the caller cannot see are reported as not liked rather than omitted."
  })
  states: PostLikeStateDto[];
}

/**
 * The result of a like or an unlike.
 *
 * The authoritative `likeCount` is returned rather than a boolean, because a
 * client that decrements optimistically needs to know where the real number
 * landed — and returning it from the write removes the race between "I sent the
 * unlike" and "someone else liked it at the same moment". The post row read
 * happens inside the same transaction as the fact, so this number always
 * includes this call's effect.
 */
export class LikeResultDto {
  @ApiProperty({ format: "uuid" })
  postId: string;

  @ApiProperty({ description: "True after a like, false after an unlike" })
  liked: boolean;

  @ApiProperty({ example: 12, description: "The post's like count as of this call" })
  likeCount: number;
}
