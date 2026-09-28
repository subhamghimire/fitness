import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 9 — Notifications schema.
 *
 * Creates the four tables behind the `NotificationsModule`:
 *
 *   domain_event_outbox
 *   notifications
 *   notification_preferences
 *   notification_deliveries
 *
 * Messaging lives in a sibling migration (`1794000000000-messaging_schema.ts`)
 * so the two domains can be reviewed, shipped and reverted independently. This
 * file has no dependency on the messaging tables.
 *
 * ── Why the outbox is the load-bearing table ──────────────────────────────────
 * `domain_event_outbox` is what makes "a failed notification must not fail the
 * workout transaction" structurally true: a producer writes exactly one row
 * here, inside its own transaction, and performs no provider I/O. Every other
 * notification table is downstream of the relay and can be rebuilt from these
 * rows; nothing downstream can roll back a workout.
 *
 * ── The uniqueness decision in this migration ─────────────────────────────────
 * `uk_notifications_user_dedupe_key` on `(user_id, dedupe_key)` is the second
 * dedupe layer. Paired with `uk_outbox_idempotency_key` it means an event can
 * be published, relayed and handled any number of times and still produce
 * exactly one notification per recipient. Each of these is a correctness
 * guarantee the application depends on, not an optimisation.
 *
 * ── Column-style note ─────────────────────────────────────────────────────────
 * These are infrastructure/notification tables: no soft-delete columns, and
 * `created_at`/`updated_at` are TIMESTAMPTZ. The messaging tables (and the
 * user-facing `notifications` row) inherit AbstractEntity's TIMESTAMP columns,
 * hence the deliberate split within this migration.
 *
 * Everything is `IF NOT EXISTS` so this applies cleanly on a database that has
 * never run migrations and on one that already has the tables.
 */
export class NotificationsSchema1794000000100 implements MigrationInterface {
  name = "NotificationsSchema1794000000100";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The migration is self-contained: it can be applied to a clean database the
    // moment earlier migrations for the USER table have run.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Infrastructure metadata, not a domain entity: no soft-delete columns.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "domain_event_outbox" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "event_type" character varying(60) NOT NULL,
        "aggregate_type" character varying(40) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "actor_id" uuid,
        "audience" jsonb NOT NULL,
        "payload" jsonb NOT NULL,
        "idempotency_key" character varying(240) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_error" text,
        "dispatched_at" TIMESTAMPTZ,
        "processed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Dedupe layer one. The publisher's ON CONFLICT DO NOTHING has no conflict
    // target, so this index is what makes re-publishing a no-op.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_outbox_idempotency_key"
      ON "domain_event_outbox" ("idempotency_key")
    `);
    // Serves the relay's claim query: status = pending AND next_attempt_at <= now().
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_outbox_status_next_attempt" ON "domain_event_outbox" ("status", "next_attempt_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_outbox_aggregate" ON "domain_event_outbox" ("aggregate_type", "aggregate_id")`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_outbox_status') THEN
          ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "ck_outbox_status" CHECK ("status" IN ('pending', 'processing', 'dispatched', 'failed'));
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "user_id" uuid NOT NULL,
        "type" character varying(40) NOT NULL,
        "title" character varying(200) NOT NULL,
        "body" text NOT NULL,
        "data" jsonb,
        "actor_id" uuid,
        "source_type" character varying(40),
        "source_id" uuid,
        "dedupe_key" character varying(240) NOT NULL,
        "read_at" TIMESTAMPTZ,
        "action_url" character varying(500),
        CONSTRAINT "fk_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notifications_user_created" ON "notifications" ("user_id", "created_at")`);
    // Partial, because every unread query filters `read_at IS NULL`.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread"
      ON "notifications" ("user_id", "read_at")
      WHERE "read_at" IS NULL
    `);
    // Dedupe layer two (see the header).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_notifications_user_dedupe_key"
      ON "notifications" ("user_id", "dedupe_key")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "user_id" uuid NOT NULL,
        "in_app_enabled" boolean NOT NULL DEFAULT true,
        "push_enabled" boolean NOT NULL DEFAULT true,
        "email_enabled" boolean NOT NULL DEFAULT false,
        "muted_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "device_tokens" jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT "fk_notification_preferences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // One preference row per user; created lazily on first write, so a miss here
    // is normal rather than an error.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_notification_preferences_user"
      ON "notification_preferences" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "notification_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "channel" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_error" text,
        "provider_message_id" character varying(200),
        "sent_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_notification_deliveries_notification" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_notification_deliveries_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // At most one delivery per (notification, channel): a retried job can never
    // push or email the same notification twice on the same channel.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_notification_deliveries_notification_channel"
      ON "notification_deliveries" ("notification_id", "channel")
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_status_next_attempt" ON "notification_deliveries" ("status", "next_attempt_at")`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notification_deliveries_channel') THEN
          -- The in-app channel is deliberately excluded: the notifications row
          -- *is* the in-app delivery, so a second "sent" row would duplicate
          -- the source of truth.
          ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_channel" CHECK ("channel" IN ('push', 'email'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notification_deliveries_status') THEN
          ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_status" CHECK ("status" IN ('pending', 'sent', 'failed', 'skipped'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_notification_deliveries_attempts') THEN
          ALTER TABLE "notification_deliveries" ADD CONSTRAINT "ck_notification_deliveries_attempts" CHECK ("attempt_count" >= 0 AND "max_attempts" > 0);
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order, so no FK blocks a drop.
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "domain_event_outbox"`);
  }
}