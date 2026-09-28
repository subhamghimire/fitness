import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 9 — Messaging schema.
 *
 * Creates the four tables behind the `MessagingModule`:
 *
 *   conversations
 *   conversation_participants
 *   messages
 *   message_receipts
 *
 * Notifications live in a sibling migration (`1794000000100-notifications_schema.ts`)
 * so the two domains can be reviewed, shipped and reverted independently. The
 * split mirrors module boundaries: nothing in this file is consumed by the
 * notification pipeline, and nothing in the notification migration is consumed
 * here.
 *
 * ── The two uniqueness decisions in this migration ──────────────────────────
 * Each of these is a correctness guarantee that the application depends on, not
 * an optimisation. They are stated here because they are the reason a racing
 * relay or a duplicated send cannot fan out twice:
 *
 *   1. `uk_messages_client_id` on `(conversation_id, sender_id,
 *      client_message_id)`. The client generates `clientMessageId`, so a send
 *      retried over a flaky connection resolves to the original row. The loser
 *      of a race catches 23505 and re-reads rather than erroring.
 *
 *   2. `uk_conversations_direct_key`, PARTIAL on `direct_key IS NOT NULL`. The
 *      key is the sorted participant pair, so "start a chat with X" is
 *      idempotent and order-independent. The predicate is required: without it
 *      every GROUP thread would collide on NULL.
 *
 * ── Partial indexes that must stay partial ───────────────────────────────────
 * `uk_conversation_participants_active` and `uk_conversations_direct_key` both
 * predicate on NULL. Postgres treats NULLs as distinct in a unique index, so
 * these would silently *not* dedupe without the WHERE clause. They are written
 * out explicitly rather than left to a future `migration:generate`.
 *
 * Everything is `IF NOT EXISTS` so this applies cleanly on a database that has
 * never run migrations and on one that already has the tables.
 */
export class MessagingSchema1794000000000 implements MigrationInterface {
  name = "MessagingSchema1794000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The migration is self-contained: it can be applied to a clean database the
    // moment earlier migrations for the USER table have run.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "type" character varying(16) NOT NULL DEFAULT 'direct',
        "title" character varying(200),
        "created_by_id" uuid NOT NULL,
        "last_message_id" uuid,
        "last_message_at" TIMESTAMPTZ,
        "last_message_preview" character varying(300),
        "direct_key" character varying(200),
        CONSTRAINT "fk_conversations_created_by" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // Denormalised inbox projection — the list orders by it, so it is indexed
    // alone rather than as a composite with the unused leading `id`.
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_conversations_last_message" ON "conversations" ("last_message_at")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_conversations_direct_key"
      ON "conversations" ("direct_key")
      WHERE "direct_key" IS NOT NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conversations_type') THEN
          ALTER TABLE "conversations" ADD CONSTRAINT "ck_conversations_type" CHECK ("type" IN ('direct', 'group'));
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_participants" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" character varying(16) NOT NULL DEFAULT 'member',
        "last_read_message_id" uuid,
        "last_read_at" TIMESTAMPTZ,
        "last_delivered_message_id" uuid,
        "last_delivered_at" TIMESTAMPTZ,
        "is_muted" boolean NOT NULL DEFAULT false,
        "joined_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "left_at" TIMESTAMPTZ,
        "unread_count" integer NOT NULL DEFAULT 0,
        "read_state" character varying(16) NOT NULL DEFAULT 'sent',
        CONSTRAINT "fk_cp_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_cp_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_conversation_participants_user_active" ON "conversation_participants" ("user_id", "left_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_conversation_participants_conversation_active" ON "conversation_participants" ("conversation_id", "left_at")`);
    // At most one ACTIVE membership per (conversation, user). Partial, so a user
    // who leaves and is re-invited gets a fresh row while still being unable to
    // hold two live ones. This is the authorisation boundary for the module.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_conversation_participants_active"
      ON "conversation_participants" ("conversation_id", "user_id")
      WHERE "left_at" IS NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conversation_participants_role') THEN
          ALTER TABLE "conversation_participants" ADD CONSTRAINT "ck_conversation_participants_role" CHECK ("role" IN ('owner', 'admin', 'member'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conversation_participants_read_state') THEN
          ALTER TABLE "conversation_participants" ADD CONSTRAINT "ck_conversation_participants_read_state" CHECK ("read_state" IN ('sent', 'delivered', 'read'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conversation_participants_unread_count') THEN
          -- The counter is recomputed with a COUNT(*) subquery in markRead, so a
          -- negative value could only ever be a bug; refuse it at the boundary.
          ALTER TABLE "conversation_participants" ADD CONSTRAINT "ck_conversation_participants_unread_count" CHECK ("unread_count" >= 0);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "conversation_id" uuid NOT NULL,
        "sender_id" uuid NOT NULL,
        "type" character varying(16) NOT NULL DEFAULT 'text',
        "body" text,
        "reply_to_id" uuid,
        "client_message_id" character varying(100) NOT NULL,
        "metadata" jsonb,
        "edited_at" TIMESTAMPTZ,
        CONSTRAINT "fk_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_messages_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_messages_reply_to" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created" ON "messages" ("conversation_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_messages_sender_created" ON "messages" ("sender_id", "created_at")`);
    // The send-idempotency guarantee (see the header).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_messages_client_id"
      ON "messages" ("conversation_id", "sender_id", "client_message_id")
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_messages_type') THEN
          ALTER TABLE "messages" ADD CONSTRAINT "ck_messages_type" CHECK ("type" IN ('text', 'image', 'system'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_messages_has_content') THEN
          -- A message must carry something: a text body, or attachment metadata
          -- for an image. Enforced here because the body column is nullable by
          -- design (an image message carries only metadata).
          ALTER TABLE "messages" ADD CONSTRAINT "ck_messages_has_content" CHECK ("body" IS NOT NULL OR "metadata" IS NOT NULL);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_receipts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "message_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "delivered_at" TIMESTAMPTZ,
        "read_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_message_receipts_message" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_message_receipts_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_message_receipts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    // Clients re-report state on every foreground and reconnect, so this insert
    // is on a hot path; uniqueness turns the repeat report into a no-op.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uk_message_receipts_message_user"
      ON "message_receipts" ("message_id", "user_id")
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_message_receipts_user" ON "message_receipts" ("user_id", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order, so no FK blocks a drop.
    await queryRunner.query(`DROP TABLE IF EXISTS "message_receipts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_participants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
  }
}