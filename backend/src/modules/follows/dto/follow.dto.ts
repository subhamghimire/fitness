import { ApiProperty } from "@nestjs/swagger";
import { CursorPageMetaDto, CursorQueryDto } from "src/common/dto";
import { SocialUserSummaryDto } from "src/shared/social/social-user-presenter.service";

/**
 * Cursor for the two follow lists. Ordering is always
 * `(created_at DESC, id DESC)`, so the cursor document's `s` value is shared by
 * both directions and a cursor cannot be replayed against the other list.
 */
export class FollowListQueryDto extends CursorQueryDto {}

const FOLLOW_LIST_ORDER = "follow_created_desc" as const;

/** Cursor strategy name for the follow lists; also the value the cursor is bound to. */
export const FOLLOW_LIST_CURSOR_STRATEGY = FOLLOW_LIST_ORDER;

/**
 * A user in a follower/following list.
 *
 * Extends `SocialUserSummaryDto` (never a full `User`) — a follower list is not
 * an address book. `followedAt` is the instant the *edge* became live, which is
 * what the list is ordered by.
 */
export class FollowUserResponseDto extends SocialUserSummaryDto {
  @ApiProperty({ description: "When the follow edge became live" })
  followedAt: Date;
}

export class FollowListResponseDto {
  @ApiProperty({ type: [FollowUserResponseDto] })
  data: FollowUserResponseDto[];

  @ApiProperty({ type: CursorPageMetaDto })
  meta: CursorPageMetaDto;
}

/**
 * The complete relationship between the caller and one other user, in one call.
 *
 * A client rendering a profile needs all five facts to decide which buttons to
 * show, and fetching them separately is both slower and a source of inconsistent
 * UI (a "Follow" button over a post that is about to 403).
 */
export class FollowStateResponseDto {
  @ApiProperty({ type: SocialUserSummaryDto })
  user: SocialUserSummaryDto;

  @ApiProperty({ description: "The caller follows this user" })
  isFollowing: boolean;

  @ApiProperty({ description: "This user follows the caller" })
  isFollowedBy: boolean;

  @ApiProperty({ description: "The caller has blocked this user" })
  isBlocked: boolean;

  @ApiProperty({ description: "This user has blocked the caller" })
  isBlockedBy: boolean;

  @ApiProperty({ description: "How many users follow this user" })
  followerCount: number;

  @ApiProperty({ description: "How many users this user follows" })
  followingCount: number;
}
