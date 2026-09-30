/**
 * FOLLOWS / BLOCKS ENUMS
 */

/**
 * Why a user blocked someone. Free-form enough to be useful to the blocker,
 * never load-bearing for enforcement — see `UserBlock.reason`.
 */
export enum BlockReason {
  SPAM = "spam",
  HARASSMENT = "harassment",
  HATE = "hate",
  SEXUAL = "sexual",
  IMPERSONATION = "impersonation",
  OTHER = "other"
}

/** A follow edge is live or soft-deleted; there is no intermediate state. */
export const LIVE_FOLLOW_PREDICATE = '"isDeleted" = false' as const;
