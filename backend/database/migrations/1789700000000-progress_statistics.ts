import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Progress / statistics foundation (Phase 4).
 *
 * Creates the materialized projection layer and its durable work queue:
 *
 *   - `workout_stats`          1 row / workout: totals the dashboard aggregates.
 *   - `workout_exercise_stats` 1 row / (workout, exercise) session: powers
 *                              exercise progression + PR detection scans.
 *   - `exercise_stats`         1 row / (user, exercise): absolute bests + refs.
 *   - `personal_records`       derived PR event chain (never hand-edited).
 *   - `progress_workout_queue` durable queue; enqueued inside the sync
 *                              transaction, drained with FOR UPDATE SKIP LOCKED.
 *
 * Reads served from these tables never scan the historical `sets` table.
 *
 * FUTURE GROWTH — sets table: it is already covered by the leading
 * `(workout_exercise_id, order_index)` index; reading `sets` is bounded to a
 * single workout during reprojection (the expensive historical scan happens
 * zero times per dashboard request). If `sets` ever approaches the millions of
 * rows, partition by `workout_exercise_id`, or archive workouts older than a
 * retention window — the projections keep working unchanged because they
 * recompute a single workout at a time.
 */
export class ProgressStatistics1789700000000 implements MigrationInterface {
  name = "ProgressStatistics1789700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── workout_stats ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workout_stats" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workout_id" uuid NOT NULL,
        "name" character varying(150),
        "started_at" TIMESTAMP NOT NULL,
        "duration_seconds" integer,
        "volume_kg" double precision NOT NULL DEFAULT 0,
        "reps" integer NOT NULL DEFAULT 0,
        "set_count" integer NOT NULL DEFAULT 0,
        "exercise_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "uq_workout_stats_workout" UNIQUE ("workout_id"),
        CONSTRAINT "fk_workout_stats_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_workout_stats_workout" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workout_stats_user_started"
      ON "workout_stats" ("user_id", "started_at")
    `);

    // ── workout_exercise_stats ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workout_exercise_stats" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "workout_id" uuid NOT NULL,
        "workout_exercise_id" uuid NOT NULL,
        "exercise_id" uuid,
        "name" character varying(200),
        "started_at" TIMESTAMP NOT NULL,
        "set_count" integer NOT NULL DEFAULT 0,
        "reps" integer NOT NULL DEFAULT 0,
        "volume_kg" double precision NOT NULL DEFAULT 0,
        "best_weight_kg" double precision,
        "best_reps" integer,
        "best_estimated_1rm_kg" double precision,
        "best_distance_m" double precision,
        "best_time_seconds" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "uq_wes_workout_exercise" UNIQUE ("workout_id", "exercise_id"),
        CONSTRAINT "uq_wes_workout_exercise_id" UNIQUE ("workout_exercise_id"),
        CONSTRAINT "fk_wes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_wes_workout" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wes_user_exercise_started"
      ON "workout_exercise_stats" ("user_id", "exercise_id", "started_at")
    `);

    // ── exercise_stats ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "exercise_stats" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "exercise_id" uuid NOT NULL,
        "exercise_name" character varying(200),
        "workout_count" integer NOT NULL DEFAULT 0,
        "total_volume_kg" double precision NOT NULL DEFAULT 0,
        "total_reps" bigint NOT NULL DEFAULT 0,
        "first_performed_at" TIMESTAMP,
        "last_performed_at" TIMESTAMP,
        "best_weight_kg" double precision,
        "best_reps" integer,
        "best_volume_kg" double precision,
        "best_estimated_1rm_kg" double precision,
        "best_distance_m" double precision,
        "best_time_seconds" integer,
        "best_weight_workout_id" uuid,
        "best_weight_workout_exercise_id" uuid,
        "best_weight_at" TIMESTAMP,
        "best_reps_workout_id" uuid,
        "best_reps_workout_exercise_id" uuid,
        "best_reps_at" TIMESTAMP,
        "best_volume_workout_id" uuid,
        "best_volume_workout_exercise_id" uuid,
        "best_volume_at" TIMESTAMP,
        "best_1rm_workout_id" uuid,
        "best_1rm_workout_exercise_id" uuid,
        "best_1rm_at" TIMESTAMP,
        "best_distance_workout_id" uuid,
        "best_distance_workout_exercise_id" uuid,
        "best_distance_at" TIMESTAMP,
        "best_time_workout_id" uuid,
        "best_time_workout_exercise_id" uuid,
        "best_time_at" TIMESTAMP,
        "muscle_group" character varying(80),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "uq_exercise_stats_user_exercise" UNIQUE ("user_id", "exercise_id"),
        CONSTRAINT "fk_exercise_stats_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_exercise_stats_user_last_performed"
      ON "exercise_stats" ("user_id", "last_performed_at")
    `);

    // ── personal_records ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "personal_records" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "exercise_id" uuid,
        "exercise_name" character varying(200),
        "pr_type" character varying(40) NOT NULL,
        "value" double precision NOT NULL,
        "workout_id" uuid NOT NULL,
        "workout_exercise_id" uuid NOT NULL,
        "achieved_at" TIMESTAMP NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_pr_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pr_workout" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pr_user_achieved"
      ON "personal_records" ("user_id", "achieved_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pr_user_exercise_type"
      ON "personal_records" ("user_id", "exercise_id", "pr_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pr_achieved_at"
      ON "personal_records" ("achieved_at")
    `);

    // ── progress_workout_queue (durable projection queue) ────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "progress_workout_queue" (
        "id" SERIAL PRIMARY KEY,
        "user_id" uuid NOT NULL,
        "workout_id" uuid NOT NULL,
        "reason" character varying(20) NOT NULL DEFAULT 'modified',
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "processed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_progress_queue_user_workout" UNIQUE ("user_id", "workout_id"),
        CONSTRAINT "fk_progress_queue_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_progress_queue_workout" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_progress_queue_status_id"
      ON "progress_workout_queue" ("status", "id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "progress_workout_queue"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "personal_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "exercise_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workout_exercise_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workout_stats"`);
  }
}