/**
 * LIKES ENUMS
 * ---------------------------------------------------------------------------
 * A like is a boolean, not a taxonomy. There is deliberately no "reaction"
 * vocabulary here yet — every additional reaction is a column, a counter
 * strategy and a moderation surface, and none of them should be added before
 * there is a product reason. `isDeleted` on the row is the entire state machine.
 */

/**
 * The only reaction a like can express, named so the API reads well while the
 * storage stays a plain boolean edge.
 */
export const LIKE_REACTION = "like" as const;

export type LikeReaction = typeof LIKE_REACTION;
