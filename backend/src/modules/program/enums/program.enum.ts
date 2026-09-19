/**
 * Lifecycle of a program assignment.
 *
 * Like coach-client relationships, historical assignments are preserved:
 * terminal states (COMPLETED / CANCELLED) are never overwritten and a repeated
 * assignment of the same program to the same client creates a NEW row.
 */
export enum ProgramAssignmentStatus {
  UPCOMING = "upcoming",
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled"
}

/** Statuses that count as a currently-live assignment (mirrored in `isActive`). */
export const ACTIVE_ASSIGNMENT_STATUSES: ProgramAssignmentStatus[] = [ProgramAssignmentStatus.UPCOMING, ProgramAssignmentStatus.ACTIVE];
