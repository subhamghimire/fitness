import { DomainEventType } from "src/common/events";

/**
 * NOTIFICATION DOMAIN ENUMS
 *
 * `NotificationType` is 1:1 with the `DomainEventType` set: every event the
 * pipeline understands maps to exactly one user-facing notification kind, and a
 * preference is stored per kind. Keeping the two in lockstep means a new event
 * cannot be added without also being categorisable by users.
 */
export enum NotificationType {
  WORKOUT_COMPLETED = "workout_completed",
  PERSONAL_RECORD_ACHIEVED = "personal_record_achieved",
  COACH_INVITATION = "coach_invitation",
  PROGRAM_ASSIGNED = "program_assigned",
  COMMENT_ADDED = "comment_added",
  NEW_FOLLOWER = "new_follower",
  MESSAGE = "message"
}

export enum NotificationChannel {
  IN_APP = "in_app",
  PUSH = "push",
  EMAIL = "email"
}

export enum NotificationDeliveryStatus {
  PENDING = "pending",
  SENT = "sent",
  FAILED = "failed",
  SKIPPED = "skipped"
}

/** Lifecycle of a transactional-outbox row. */
export enum DomainEventOutboxStatus {
  /** Waiting to be handed to the background job queue. */
  PENDING = "pending",
  /** Claimed by a relay instance; the hand-off to the queue is in flight. */
  PROCESSING = "processing",
  /** Handed to the queue. The job now owns the row. */
  DISPATCHED = "dispatched",
  /** Relay exhausted its attempts; needs operator attention. */
  FAILED = "failed"
}

/** Maps a domain event to the notification kind it materialises as. */
export const EVENT_TYPE_TO_NOTIFICATION_TYPE: Readonly<Record<DomainEventType, NotificationType>> = Object.freeze({
  [DomainEventType.WORKOUT_COMPLETED]: NotificationType.WORKOUT_COMPLETED,
  [DomainEventType.PERSONAL_RECORD_ACHIEVED]: NotificationType.PERSONAL_RECORD_ACHIEVED,
  [DomainEventType.COACH_INVITATION_RECEIVED]: NotificationType.COACH_INVITATION,
  [DomainEventType.PROGRAM_ASSIGNED]: NotificationType.PROGRAM_ASSIGNED,
  [DomainEventType.COMMENT_ADDED]: NotificationType.COMMENT_ADDED,
  [DomainEventType.NEW_FOLLOWER]: NotificationType.NEW_FOLLOWER,
  [DomainEventType.MESSAGE_RECEIVED]: NotificationType.MESSAGE
});

/** Channels that are delivered by a provider, i.e. the retried background job. */
export const PROVIDER_CHANNELS: readonly NotificationChannel[] = Object.freeze([NotificationChannel.PUSH, NotificationChannel.EMAIL]);
