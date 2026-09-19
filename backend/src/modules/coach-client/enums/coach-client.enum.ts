/**
 * Lifecycle of a coach <-> client relationship.
 *
 * The relationship row is IMMUTABLE while it is live: every lifecycle change
 * is a status transition on the same row (PENDING -> ACTIVE -> PAUSED -> ...);
 * terminal states (ENDED / BLOCKED) are never overwritten. A brand new
 * relationship between the same coach and client is a NEW row, so the full
 * history is always preserved.
 */
export enum RelationshipStatus {
  PENDING = "pending",
  ACTIVE = "active",
  PAUSED = "paused",
  ENDED = "ended",
  BLOCKED = "blocked"
}

export const LIVELY_RELATIONSHIP_STATUSES = [RelationshipStatus.PENDING, RelationshipStatus.ACTIVE, RelationshipStatus.PAUSED] as const;
