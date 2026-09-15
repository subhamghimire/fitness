import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sync changelog foundation.
 *
 * - Creates the append-only `sync_changes` log used as the monotonic pull cursor.
 * - Adds `client_updated_at` (client logical mutation time) to every syncable entity.
 * - Adds `sync_revision` (numeric cursor) to `user_sync_state`.
 * - Backfills `client_updated_at` from `updated_at` for pre-migration rows.
 *
 * The pull cursor is `sync_changes.id`, never a wall-clock timestamp.
 */
export class SyncChangelog1773000000000 implements MigrationInterface {
  name = "SyncChangelog1773000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sync_changes" (
        "id" SERIAL PRIMARY KEY,
        "user_id" uuid NOT NULL,
        "entity_type" character varying(50) NOT NULL,
        "entity_id" uuid NOT NULL,
        "operation" character varying(10) NOT NULL,
        "revision" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_sync_changes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    // PULL: per-user cursor traversal.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sync_changes_user_cursor" ON "sync_changes" ("user_id", "id")`
    );
    // History / dedup lookups by entity.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sync_changes_user_entity" ON "sync_changes" ("user_id", "entity_type", "entity_id")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sync_changes_entity_id" ON "sync_changes" ("entity_id")`
    );

    // client_updated_at: logical time of the client mutation used for conflict resolution.
    await queryRunner.query(
      `ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "workout_exercises" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "sets" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "user_templates" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "user_template_exercises" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "user_template_sets" ADD COLUMN IF NOT EXISTS "client_updated_at" TIMESTAMPTZ`
    );

    // Backfill pre-migration rows: last server timestamp is the best known approximation.
    await queryRunner.query(
      `UPDATE "workouts" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );
    await queryRunner.query(
      `UPDATE "workout_exercises" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );
    await queryRunner.query(
      `UPDATE "sets" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );
    await queryRunner.query(
      `UPDATE "user_templates" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );
    await queryRunner.query(
      `UPDATE "user_template_exercises" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );
    await queryRunner.query(
      `UPDATE "user_template_sets" SET "client_updated_at" = "updated_at" WHERE "client_updated_at" IS NULL`
    );

    // Monotonic per-user sync cursor.
    await queryRunner.query(
      `ALTER TABLE "user_sync_state" ADD COLUMN IF NOT EXISTS "sync_revision" integer NOT NULL DEFAULT 0`
    );

    // Let PULL traverse the boundary of a user's workout family without expensive joins.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_workout_exercises_workout_updated" ON "workout_exercises" ("workout_id", "updated_at")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_changes"`);
    await queryRunner.query(`ALTER TABLE "user_sync_state" DROP COLUMN IF EXISTS "sync_revision"`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" DROP COLUMN IF EXISTS "client_updated_at"`);
    await queryRunner.query(`ALTER TABLE "workouts" DROP COLUMN IF EXISTS "client_updated_at"`);
    await queryRunner.query(`ALTER TABLE "sets" DROP COLUMN IF EXISTS "client_updated_at"`);
    await queryRunner.query(`ALTER TABLE "user_template_sets" DROP COLUMN IF EXISTS "client_updated_at"`);
    await queryRunner.query(`ALTER TABLE "user_template_exercises" DROP COLUMN IF EXISTS "client_updated_at"`);
    await queryRunner.query(`ALTER TABLE "user_templates" DROP COLUMN IF EXISTS "client_updated_at"`);
  }
}