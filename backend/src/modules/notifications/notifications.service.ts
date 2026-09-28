import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { createPaginatedResponse } from "src/common/dto";
import { JsonObject } from "src/common/json";
import { Notification, NotificationDelivery, NotificationPreference } from "./entities";
import { NOTIFICATION_PREFERENCE_DEFAULTS } from "./entities/notification-preference.entity";
import { NotificationChannel, NotificationDeliveryStatus, NotificationType } from "./enums";
import { NotificationQueryDto } from "./dto/notification-query.dto";
import {
  NotificationMarkReadResultDto,
  NotificationPreferenceResponseDto,
  NotificationResponseDto,
  NotificationUnreadCountDto,
  PaginatedNotificationResponseDto
} from "./dto/notification-response.dto";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

/** Effective, always-resolved preferences — never null fields. */
export interface EffectivePreferences {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  mutedTypes: NotificationType[];
  deviceTokens: string[];
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: JsonObject | null;
  actorId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  actionUrl: string | null;
  /** Derived from the event's idempotency key; unique per recipient. */
  dedupeKey: string;
}

export interface CreateNotificationResult {
  notification: Notification;
  /** false when an identical notification already existed (duplicate event). */
  created: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(NotificationPreference) private readonly preferencesRepo: Repository<NotificationPreference>,
    @InjectRepository(NotificationDelivery) private readonly deliveriesRepo: Repository<NotificationDelivery>
  ) {}

  // ─── In-app inbox ─────────────────────────────────────────────────────────

  async list(userId: string, query: NotificationQueryDto): Promise<PaginatedNotificationResponseDto> {
    const { page = 1, limit = 10, unreadOnly } = query;
    const where = { userId, isDeleted: false, ...(unreadOnly ? { readAt: IsNull() } : {}) };

    const [rows, total] = await this.notificationsRepo.findAndCount({
      where,
      order: { createdAt: "DESC", id: "DESC" },
      skip: (page - 1) * limit,
      take: limit
    });

    return createPaginatedResponse(
      rows.map((row) => this.toResponseDto(row)),
      total,
      page,
      limit
    );
  }

  async unreadCount(userId: string): Promise<NotificationUnreadCountDto> {
    const unread = await this.notificationsRepo.count({ where: { userId, isDeleted: false, readAt: IsNull() } });
    return { unread };
  }

  /**
   * Marks one notification read. Scoped by `userId` in the UPDATE itself rather
   * than trusting a prior lookup, so a guessed id belonging to somebody else
   * matches zero rows and 404s instead of being marked.
   */
  async markRead(userId: string, id: string): Promise<NotificationResponseDto> {
    const existing = await this.notificationsRepo.findOne({ where: { id, userId, isDeleted: false } });
    if (!existing) throw new NotFoundException("Notification not found");

    if (!existing.readAt) {
      existing.readAt = new Date();
      await this.notificationsRepo.save(existing);
    }
    return this.toResponseDto(existing);
  }

  async markUnread(userId: string, id: string): Promise<NotificationResponseDto> {
    const existing = await this.notificationsRepo.findOne({ where: { id, userId, isDeleted: false } });
    if (!existing) throw new NotFoundException("Notification not found");

    existing.readAt = null;
    await this.notificationsRepo.save(existing);
    return this.toResponseDto(existing);
  }

  async markAllRead(userId: string): Promise<NotificationMarkReadResultDto> {
    const result = await this.notificationsRepo.update({ userId, isDeleted: false, readAt: IsNull() }, { readAt: new Date() });
    return { updated: result.affected ?? 0 };
  }

  // ─── Preferences ───────────────────────────────────────────────────────────

  /** Raw row or null — used by the preference endpoints. */
  findPreferenceRow(userId: string): Promise<NotificationPreference | null> {
    return this.preferencesRepo.findOne({ where: { userId, isDeleted: false } });
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceResponseDto> {
    const effective = await this.resolvePreferences(userId);
    return this.toPreferenceResponseDto(effective);
  }

  /**
   * Partial update. A user with no stored preferences gets defaults on first
   * write, so the table stays sparse and `resolvePreferences` can treat "no row"
   * and "row with defaults" identically.
   */
  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto): Promise<NotificationPreferenceResponseDto> {
    const existing = await this.preferencesRepo.findOne({ where: { userId, isDeleted: false } });
    const row = existing ?? this.preferencesRepo.create({ userId });

    if (dto.inAppEnabled !== undefined) row.inAppEnabled = dto.inAppEnabled;
    if (dto.pushEnabled !== undefined) row.pushEnabled = dto.pushEnabled;
    if (dto.emailEnabled !== undefined) row.emailEnabled = dto.emailEnabled;
    if (dto.mutedTypes !== undefined) row.mutedTypes = [...new Set(dto.mutedTypes)];
    if (dto.deviceTokens !== undefined) row.deviceTokens = [...new Set(dto.deviceTokens.filter((t) => t.trim().length > 0))];

    const saved = await this.preferencesRepo.save(row);
    return this.toPreferenceResponseDto({
      inAppEnabled: saved.inAppEnabled,
      pushEnabled: saved.pushEnabled,
      emailEnabled: saved.emailEnabled,
      mutedTypes: saved.mutedTypes ?? [],
      deviceTokens: saved.deviceTokens ?? []
    });
  }

  /** Adds a device token idempotently (a client re-registering must not duplicate). */
  async registerDeviceToken(userId: string, token: string): Promise<NotificationPreferenceResponseDto> {
    const existing = await this.preferencesRepo.findOne({ where: { userId, isDeleted: false } });
    const row = existing ?? this.preferencesRepo.create({ userId });
    const tokens = new Set(row.deviceTokens ?? []);
    tokens.add(token);
    row.deviceTokens = [...tokens];
    const saved = await this.preferencesRepo.save(row);
    return this.toPreferenceResponseDto({
      inAppEnabled: saved.inAppEnabled,
      pushEnabled: saved.pushEnabled,
      emailEnabled: saved.emailEnabled,
      mutedTypes: saved.mutedTypes ?? [],
      deviceTokens: saved.deviceTokens ?? []
    });
  }

  /**
   * Preferences with defaults applied. Called once per recipient per event by
   * the background handler, so a missing row is the common case, not an error.
   */
  async resolvePreferences(userId: string): Promise<EffectivePreferences> {
    const row = await this.preferencesRepo.findOne({ where: { userId, isDeleted: false } });
    if (!row) return { ...NOTIFICATION_PREFERENCE_DEFAULTS, mutedTypes: [], deviceTokens: [] };
    return {
      inAppEnabled: row.inAppEnabled,
      pushEnabled: row.pushEnabled,
      emailEnabled: row.emailEnabled,
      mutedTypes: row.mutedTypes ?? [],
      deviceTokens: row.deviceTokens ?? []
    };
  }

  // ─── Pipeline internals (background handler only) ──────────────────────────

  /**
   * Materialises one in-app notification, deduplicated on `(userId, dedupeKey)`.
   *
   * The insert is `ON CONFLICT DO NOTHING` against the unique index, so a
   * retried job, a double-published event or two workers racing all produce
   * exactly one row. Returns the existing row with `created: false` so the
   * caller can tell "I made it" from "it was already there" without a race.
   */
  async createFromEvent(input: CreateNotificationInput): Promise<CreateNotificationResult> {
    // `QueryDeepPartialEntity` is TypeORM's insert-value type; jsonb columns
    // need it explicitly because a `Record<string, unknown>` index signature
    // would otherwise be read as a nested entity to hydrate.
    const values: QueryDeepPartialEntity<Notification> = { ...input };
    const result = await this.notificationsRepo.createQueryBuilder().insert().into(Notification).values(values).orIgnore().execute();

    // `identifiers` counts attempted values even on conflict; `raw` holds only
    // the rows Postgres actually returned from the INSERT .. RETURNING.
    const created = Array.isArray(result.raw) && result.raw.length > 0;
    const notification = await this.notificationsRepo.findOne({ where: { userId: input.userId, dedupeKey: input.dedupeKey } });
    if (!notification) {
      throw new BadRequestException("Notification could not be persisted");
    }
    return { notification, created };
  }

  /**
   * Registers a push/email delivery for a notification, deduplicated on
   * `(notificationId, channel)`. Returns null when the delivery already exists,
   * so a replayed event does not schedule a second send.
   */
  async createDelivery(notificationId: string, userId: string, channel: NotificationChannel, maxAttempts: number): Promise<NotificationDelivery | null> {
    const existing = await this.deliveriesRepo.findOne({ where: { notificationId, channel } });
    if (existing) return null;

    try {
      const row = this.deliveriesRepo.create({
        notificationId,
        userId,
        channel,
        status: NotificationDeliveryStatus.PENDING,
        attemptCount: 0,
        maxAttempts,
        nextAttemptAt: new Date(),
        lastError: null,
        providerMessageId: null,
        sentAt: null
      });
      return await this.deliveriesRepo.save(row);
    } catch (error) {
      // Two workers inserting the same delivery concurrently: the unique index
      // is the authority, the loser just reports "already scheduled".
      if (this.isUniqueViolation(error)) return null;
      throw error;
    }
  }

  // ─── Mapping ───────────────────────────────────────────────────────────────

  private toResponseDto(notification: Notification): NotificationResponseDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      actorId: notification.actorId,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId,
      actionUrl: notification.actionUrl,
      readAt: notification.readAt,
      createdAt: notification.createdAt
    };
  }

  private toPreferenceResponseDto(prefs: EffectivePreferences): NotificationPreferenceResponseDto {
    return {
      inAppEnabled: prefs.inAppEnabled,
      pushEnabled: prefs.pushEnabled,
      emailEnabled: prefs.emailEnabled,
      mutedTypes: prefs.mutedTypes,
      deviceTokens: prefs.deviceTokens
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    const e = error as { code?: string; driverError?: { code?: string } };
    return (e.driverError?.code ?? e.code) === "23505";
  }
}
