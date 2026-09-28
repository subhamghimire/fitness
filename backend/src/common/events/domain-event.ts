/**
 * DOMAIN EVENT CONTRACTS
 * ---------------------------------------------------------------------------
 * These types are the *only* coupling between a producing module (workout,
 * program, coach-client, messaging) and the notification pipeline. A producer
 * states "this happened"; it never names a channel, a provider or a template.
 *
 * Why this lives in `common` rather than inside the notifications module:
 * `WorkoutService` must be able to announce a completed workout without
 * importing anything notification-shaped. Putting the contract here means the
 * dependency arrow is `workout ──▶ common/events ◀── notifications`, so the
 * graph stays acyclic and the producer is testable with a single mock.
 *
 * Delivery pipeline (see `notifications.module.ts`):
 *
 *   Domain Event ──▶ Event Handler ──▶ Background Job ──▶ Notification Provider
 *        │                  │                 │
 *   outbox row         in-app row         push / email
 *   (same txn)        (deduped)          (retried)
 *
 * The producer only ever performs step 1: it hands the event to
 * `DomainEventPublisher`, which writes a single row to the transactional outbox
 * **inside the caller's transaction**. No provider I/O, no network call and no
 * serialization work happens in the business transaction, so a notification can
 * never fail the workout write. Everything after that is asynchronous and
 * independently retryable.
 */

/** Every event the notification pipeline understands. */
export enum DomainEventType {
  WORKOUT_COMPLETED = "workout.completed",
  PERSONAL_RECORD_ACHIEVED = "personal_record.achieved",
  COACH_INVITATION_RECEIVED = "coach_invitation.received",
  PROGRAM_ASSIGNED = "program.assigned",
  COMMENT_ADDED = "comment.added",
  NEW_FOLLOWER = "new_follower",
  MESSAGE_RECEIVED = "message.received"
}

/** The aggregate an event is rooted in — used for tracing and idempotency. */
export enum DomainAggregateType {
  WORKOUT = "workout",
  PERSONAL_RECORD = "personal_record",
  COACH_CLIENT_RELATIONSHIP = "coach_client_relationship",
  PROGRAM_ASSIGNMENT = "program_assignment",
  COMMENT = "comment",
  FOLLOW = "follow",
  MESSAGE = "message"
}

/**
 * Who should be told about an event.
 *
 * Deliberately *not* a concrete user id list. Resolving recipients is the
 * notification layer's job, and doing it lazily (at handling time, off the
 * producer's hot path) means a sync batch does not pay for a coach lookup
 * inside the workout transaction, and a user who gains a coach between the
 * event and its handling still receives it.
 */
export type NotificationAudience =
  /** Explicit recipients (coach invitation, program assignment, comment, follower). */
  | { kind: "users"; userIds: string[]; excludeActor: boolean }
  /** A user plus every coach holding an ACTIVE relationship with them. */
  | { kind: "user_and_active_coach"; userId: string; excludeActor: boolean }
  /** Everyone currently in a conversation (messages), minus the sender. */
  | { kind: "conversation_participants"; conversationId: string; excludeUserId: string | null };

export interface DomainEventBase<TType extends DomainEventType, TPayload> {
  readonly type: TType;
  /** Wall-clock time the domain fact occurred (not when it was relayed). */
  readonly occurredAt: Date;
  /**
   * Globally unique, deterministic natural key for this *occurrence*.
   *
   * This is the first of two dedupe layers. The outbox has a unique index on it,
   * so re-publishing the same occurrence (an offline sync replay, a projection
   * reprojection) is a no-op insert and can never produce a second
   * notification. It must therefore encode everything that distinguishes two
   * legitimate occurrences — see `buildIdempotencyKey`.
   */
  readonly idempotencyKey: string;
  /** The user who caused the event, or null for system events. */
  readonly actorId: string | null;
  readonly audience: NotificationAudience;
  readonly aggregate: { type: DomainAggregateType; id: string };
  readonly payload: TPayload;
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface WorkoutCompletedPayload {
  workoutId: string;
  workoutName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface PersonalRecordAchievedPayload {
  exerciseId: string | null;
  exerciseName: string | null;
  prType: string;
  value: number;
  workoutId: string;
  achievedAt: string;
}

export interface CoachInvitationReceivedPayload {
  relationshipId: string;
  coachId: string;
  coachName: string;
}

export interface ProgramAssignedPayload {
  assignmentId: string;
  programId: string;
  programName: string;
  startDate: string | null;
  endDate: string | null;
}

export interface CommentAddedPayload {
  commentId: string;
  authorName: string | null;
  excerpt: string;
  targetType: string;
  targetId: string;
}

export interface NewFollowerPayload {
  followerId: string;
  followerName: string | null;
}

export interface MessageReceivedPayload {
  messageId: string;
  conversationId: string;
  senderName: string | null;
  excerpt: string;
}

// ─── Concrete events ──────────────────────────────────────────────────────────

export type WorkoutCompletedEvent = DomainEventBase<DomainEventType.WORKOUT_COMPLETED, WorkoutCompletedPayload>;
export type PersonalRecordAchievedEvent = DomainEventBase<DomainEventType.PERSONAL_RECORD_ACHIEVED, PersonalRecordAchievedPayload>;
export type CoachInvitationReceivedEvent = DomainEventBase<DomainEventType.COACH_INVITATION_RECEIVED, CoachInvitationReceivedPayload>;
export type ProgramAssignedEvent = DomainEventBase<DomainEventType.PROGRAM_ASSIGNED, ProgramAssignedPayload>;
export type CommentAddedEvent = DomainEventBase<DomainEventType.COMMENT_ADDED, CommentAddedPayload>;
export type NewFollowerEvent = DomainEventBase<DomainEventType.NEW_FOLLOWER, NewFollowerPayload>;
export type MessageReceivedEvent = DomainEventBase<DomainEventType.MESSAGE_RECEIVED, MessageReceivedPayload>;

export type DomainEvent =
  | WorkoutCompletedEvent
  | PersonalRecordAchievedEvent
  | CoachInvitationReceivedEvent
  | ProgramAssignedEvent
  | CommentAddedEvent
  | NewFollowerEvent
  | MessageReceivedEvent;

/** Maps an event type to its payload, for handlers that switch on `type`. */
export interface DomainEventPayloadMap {
  [DomainEventType.WORKOUT_COMPLETED]: WorkoutCompletedPayload;
  [DomainEventType.PERSONAL_RECORD_ACHIEVED]: PersonalRecordAchievedPayload;
  [DomainEventType.COACH_INVITATION_RECEIVED]: CoachInvitationReceivedPayload;
  [DomainEventType.PROGRAM_ASSIGNED]: ProgramAssignedPayload;
  [DomainEventType.COMMENT_ADDED]: CommentAddedPayload;
  [DomainEventType.NEW_FOLLOWER]: NewFollowerPayload;
  [DomainEventType.MESSAGE_RECEIVED]: MessageReceivedPayload;
}

export type DomainEventOfType<T extends DomainEventType> = DomainEventBase<T, DomainEventPayloadMap[T]>;

/**
 * Builds the deterministic natural key used for outbox-level deduplication.
 *
 * The key MUST include a discriminator beyond the aggregate id whenever the same
 * aggregate can legitimately produce the same event more than once. Two real
 * cases in this codebase:
 *
 *   - `ProgressProjectionService` deletes and regenerates the whole PR chain for
 *     a (user, exercise) on every reprojection, so "a PR was achieved" must be
 *     keyed by the workout that produced it, not by the exercise.
 *   - a workout can be un-finished and finished again, so the completion key
 *     carries the session start timestamp.
 */
export function buildIdempotencyKey(type: DomainEventType, aggregateId: string, discriminator = ""): string {
  return discriminator ? `${type}:${aggregateId}:${discriminator}` : `${type}:${aggregateId}`;
}

/** Coarse clamp so a long `extra` snippet can never blow past a text column. */
export function excerpt(text: string, max = 120): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
