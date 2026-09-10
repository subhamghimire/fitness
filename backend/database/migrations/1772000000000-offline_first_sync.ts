import { MigrationInterface, QueryRunner } from "typeorm";

export class OfflineFirstSync1772000000000 implements MigrationInterface {
  name = "OfflineFirstSync1772000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workouts" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "sets" ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" ADD COLUMN IF NOT EXISTS "name" character varying(200)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_sync_state" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "user_id" uuid NOT NULL UNIQUE,
        "sync_token" character varying(100),
        "client_id" character varying(100),
        CONSTRAINT "fk_user_sync_state_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_templates" (
        "id" uuid PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "user_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "fk_user_templates_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_user_templates_user_id" ON "user_templates" ("user_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_user_templates_updated_at" ON "user_templates" ("updated_at")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_template_exercises" (
        "id" uuid PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "template_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "order_index" integer NOT NULL DEFAULT 0,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "fk_user_template_exercises_template" FOREIGN KEY ("template_id") REFERENCES "user_templates"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_user_template_exercises_template_id" ON "user_template_exercises" ("template_id")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_template_sets" (
        "id" uuid PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        "template_exercise_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "order_index" integer NOT NULL DEFAULT 0,
        "weight" double precision,
        "reps" integer,
        "is_warmup" boolean NOT NULL DEFAULT false,
        "is_dropset" boolean NOT NULL DEFAULT false,
        "is_failure" boolean NOT NULL DEFAULT false,
        "revision" integer NOT NULL DEFAULT 1,
        CONSTRAINT "fk_user_template_sets_exercise" FOREIGN KEY ("template_exercise_id") REFERENCES "user_template_exercises"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_user_template_sets_exercise_id" ON "user_template_sets" ("template_exercise_id")`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_workouts_user_updated" ON "workouts" ("user_id", "updated_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_workout_exercises_updated" ON "workout_exercises" ("updated_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_sets_updated" ON "sets" ("updated_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_template_sets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_template_exercises"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sync_state"`);
    await queryRunner.query(`ALTER TABLE "sets" DROP COLUMN IF EXISTS "revision"`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" DROP COLUMN IF EXISTS "revision"`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" DROP COLUMN IF EXISTS "name"`);
    await queryRunner.query(`ALTER TABLE "workouts" DROP COLUMN IF EXISTS "revision"`);
  }
}
