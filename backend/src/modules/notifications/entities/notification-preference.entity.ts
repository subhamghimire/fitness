import { Column, Entity, Index } from "typeorm";
import { AbstractEntity } from "src/entities";
import { NotificationType } from "../enums";

export const NOTIFICATION_PREFERENCE_DEFAULTS = {
  inAppEnabled: true,
  pushEnabled: true,
  /** Email is opt-in: a user must actively ask to be emailed. */
  emailEnabled: false,
  mutedTypes: [] as NotificationType[]
} as const;

/**
 * PER-USER NOTIFICATION PREFERENCES
 *
 * One row per user, created lazily on first write. Granularity is deliberately
 * "channel on/off + per-kind mute list" rather than a matrix of every kind ×
 * channel: it covers the real product need (stop emailing me, mute follower
 * notifications) without a 21-row join for every recipient.
 *
 * `deviceTokens` is the push provider's address book. A production deployment
 * would move this to a `push_subscriptions` table with per-platform rows so a
 * single device can be invalidated without touching the rest; the abstraction
 * (`PushNotificationProvider`) only needs a token, so that refactor is
 * contained to this module.
 */
@Entity("notification_preferences")
export class NotificationPreference extends AbstractEntity {
  @Index("uk_notification_preferences_user", { unique: true })
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "in_app_enabled", type: "boolean", default: NOTIFICATION_PREFERENCE_DEFAULTS.inAppEnabled })
  inAppEnabled: boolean;

  @Column({ name: "push_enabled", type: "boolean", default: NOTIFICATION_PREFERENCE_DEFAULTS.pushEnabled })
  pushEnabled: boolean;

  @Column({ name: "email_enabled", type: "boolean", default: NOTIFICATION_PREFERENCE_DEFAULTS.emailEnabled })
  emailEnabled: boolean;

  /**
   * Notification kinds this user has explicitly muted.
   *
   * The default is written without an explicit `::jsonb` cast on purpose: the
   * column is already jsonb, and TypeORM normalises a function-style default by
   * stripping the cast, so declaring it *with* the cast makes the schema
   * builder report permanent phantom drift. The migration writes
   * `'[]'::jsonb`, which Postgres stores identically.
   */
  @Column({ name: "muted_types", type: "jsonb", default: () => "'[]'" })
  mutedTypes: NotificationType[];

  /** Push provider device tokens for this user. */
  @Column({ name: "device_tokens", type: "jsonb", default: () => "'[]'" })
  deviceTokens: string[];
}
