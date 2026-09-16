import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fitness domain architecture: unify the sync-era "user_*" tables with the
 * workout domain modules.
 *
 * - `user_workouts`      → `favorite_exercises` (rename table + camelCase FK
 *   columns to snake_case, dedupe, add unique (user_id, exercise_id)).
 * - `user_templates`     → `workout_templates`
 * - `user_template_exercises` → `workout_template_exercises` (+ catalog ref
 *   `exercise_id` SET NULL, `notes`, `rest_seconds`).
 * - `user_template_sets` → `workout_template_sets` (+ `rpe`,
 *   `duration_seconds`, `distance`).
 * - `workout_exercises.exercise_id` becomes nullable with ON DELETE SET NULL
 *   so user history survives catalog deletion.
 * - Composite index pairs added for the sync pull/apply hot paths.
 */
export class FitnessDomainArchitecture1774000000000 implements MigrationInterface {
  name = "FitnessDomainArchitecture1774000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── favourite_exercises ────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "user_workouts" RENAME TO "favorite_exercises"`);
    await queryRunner.query(`ALTER TABLE "favorite_exercises" RENAME COLUMN "userId" TO "user_id"`);
    await queryRunner.query(`ALTER TABLE "favorite_exercises" RENAME COLUMN "exerciseId" TO "exercise_id"`);

    // Dedupe (keep the earliest-created row per user+exercise pair).
    await queryRunner.query(`
      DELETE FROM "favorite_exercises" fe
      WHERE fe."id" IN (
        SELECT "id"
        FROM (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY "user_id", "exercise_id"
                   ORDER BY "created_at" ASC, "id" ASC
                 ) AS rn
          FROM "favorite_exercises"
        ) ranked
        WHERE rn > 1
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_favorite_exercises_user_exercise"
      ON "favorite_exercises" ("user_id", "exercise_id")
    `);

    // ── workout templates ───────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "user_templates" RENAME TO "workout_templates"`);
    await queryRunner.query(`ALTER TABLE "user_template_exercises" RENAME TO "workout_template_exercises"`);
    await queryRunner.query(`ALTER TABLE "user_template_sets" RENAME TO "workout_template_sets"`);

    // Template exercises: optional catalog reference + display extras.
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" ADD COLUMN IF NOT EXISTS "exercise_id" uuid`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" ADD COLUMN IF NOT EXISTS "notes" text`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" ADD COLUMN IF NOT EXISTS "rest_seconds" integer`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_workout_template_exercises_exercise'
        ) THEN
          ALTER TABLE "workout_template_exercises"
          ADD CONSTRAINT "fk_workout_template_exercises_exercise"
          FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Template sets: conditioning + RPE support.
    await queryRunner.query(`ALTER TABLE "workout_template_sets" ADD COLUMN IF NOT EXISTS "rpe" integer`);
    await queryRunner.query(`ALTER TABLE "workout_template_sets" ADD COLUMN IF NOT EXISTS "duration_seconds" integer`);
    await queryRunner.query(`ALTER TABLE "workout_template_sets" ADD COLUMN IF NOT EXISTS "distance" double precision`);

    // ── workout_exercises: history survives catalog deletion ───────────────
    await queryRunner.query(`ALTER TABLE "workout_exercises" DROP CONSTRAINT IF EXISTS "FK_9a0656f321d9a96de2eb685e85a"`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" ALTER COLUMN "exercise_id" DROP NOT NULL`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_workout_exercises_exercise'
        ) THEN
          ALTER TABLE "workout_exercises"
          ADD CONSTRAINT "fk_workout_exercises_exercise"
          FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ── Composite index pairs for sync hot paths ───────────────────────────
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workouts_user_started_at"
      ON "workouts" ("user_id", "started_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workout_exercises_exercise_updated"
      ON "workout_exercises" ("exercise_id", "updated_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workout_exercises_workout_order"
      ON "workout_exercises" ("workout_id", "order_index")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_sets_exercise_order"
      ON "sets" ("workout_exercise_id", "order_index")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_template_exercises_template_order"
      ON "workout_template_exercises" ("template_id", "order_index")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_template_sets_exercise_order"
      ON "workout_template_sets" ("template_exercise_id", "order_index")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Composite indexes ───────────────────────────────────────────────────
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_template_sets_exercise_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_template_exercises_template_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sets_exercise_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_workout_exercises_workout_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_workout_exercises_exercise_updated"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_workouts_user_started_at"`);

    // ── workout_exercises: restore NOT NULL + CASCADE FK ───────────────────
    await queryRunner.query(`ALTER TABLE "workout_exercises" DROP CONSTRAINT IF EXISTS "fk_workout_exercises_exercise"`);
    await queryRunner.query(`ALTER TABLE "workout_exercises" ALTER COLUMN "exercise_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "workout_exercises"
      ADD CONSTRAINT "FK_9a0656f321d9a96de2eb685e85a"
      FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE
    `);

    // ── Template tables: drop added columns ────────────────────────────────
    await queryRunner.query(`ALTER TABLE "workout_template_sets" DROP COLUMN IF EXISTS "distance"`);
    await queryRunner.query(`ALTER TABLE "workout_template_sets" DROP COLUMN IF EXISTS "duration_seconds"`);
    await queryRunner.query(`ALTER TABLE "workout_template_sets" DROP COLUMN IF EXISTS "rpe"`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" DROP CONSTRAINT IF EXISTS "fk_workout_template_exercises_exercise"`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" DROP COLUMN IF EXISTS "rest_seconds"`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" DROP COLUMN IF EXISTS "notes"`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" DROP COLUMN IF EXISTS "exercise_id"`);

    await queryRunner.query(`ALTER TABLE "workout_template_sets" RENAME TO "user_template_sets"`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" RENAME TO "user_template_exercises"`);
    await queryRunner.query(`ALTER TABLE "workout_templates" RENAME TO "user_templates"`);

    // ── favorite_exercises ─────────────────────────────────────────────────
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_favorite_exercises_user_exercise"`);
    await queryRunner.query(`ALTER TABLE "favorite_exercises" RENAME COLUMN "exercise_id" TO "exerciseId"`);
    await queryRunner.query(`ALTER TABLE "favorite_exercises" RENAME COLUMN "user_id" TO "userId"`);
    await queryRunner.query(`ALTER TABLE "favorite_exercises" RENAME TO "user_workouts"`);
  }
}