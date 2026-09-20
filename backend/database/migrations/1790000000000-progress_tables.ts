import { MigrationInterface, QueryRunner } from "typeorm";

export class ProgressTables1790000000000 implements MigrationInterface {
  name = "ProgressTables1790000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── workout_stats ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workout_stats" (
        "id"             uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"     TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP   NOT NULL DEFAULT now(),
        "isDeleted"      boolean     NOT NULL DEFAULT false,
        "deleted_at"     TIMESTAMPTZ,
        "deleted_by"     uuid,
        "user_id"        uuid        NOT NULL,
        "workout_id"     uuid        NOT NULL,
        "name"           varchar(150),
        "started_at"     TIMESTAMP   NOT NULL,
        "duration_seconds" integer,
        "volume_kg"      double precision NOT NULL DEFAULT 0,
        "reps"           integer     NOT NULL DEFAULT 0,
        "set_count"      integer     NOT NULL DEFAULT 0,
        "exercise_count" integer     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_workout_stats" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_workout_stats_workout"       ON "workout_stats" ("workout_id")`);
    await queryRunner.query(`CREATE INDEX        IF NOT EXISTS "idx_workout_stats_user_started" ON "workout_stats" ("user_id", "started_at")`);

    // ── workout_exercise_stats ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workout_exercise_stats" (
        "id"                      uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"              TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP   NOT NULL DEFAULT now(),
        "isDeleted"               boolean     NOT NULL DEFAULT false,
        "deleted_at"              TIMESTAMPTZ,
        "deleted_by"              uuid,
        "user_id"                 uuid        NOT NULL,
        "workout_id"              uuid        NOT NULL,
        "workout_exercise_id"     uuid        NOT NULL,
        "exercise_id"             uuid,
        "name"                    varchar(200),
        "started_at"              TIMESTAMP   NOT NULL,
        "set_count"               integer     NOT NULL DEFAULT 0,
        "reps"                    integer     NOT NULL DEFAULT 0,
        "volume_kg"               double precision NOT NULL DEFAULT 0,
        "best_weight_kg"          double precision,
        "best_reps"               integer,
        "best_estimated_1rm_kg"   double precision,
        "best_distance_m"         double precision,
        "best_time_seconds"       integer,
        CONSTRAINT "PK_workout_exercise_stats" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_wes_workout_exercise"        ON "workout_exercise_stats" ("workout_id", "exercise_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_wes_workout_exercise_id"     ON "workout_exercise_stats" ("workout_exercise_id")`);
    await queryRunner.query(`CREATE INDEX        IF NOT EXISTS "idx_wes_user_exercise_started"  ON "workout_exercise_stats" ("user_id", "exercise_id", "started_at")`);

    // ── exercise_stats ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "exercise_stats" (
        "id"                              uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"                      TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at"                      TIMESTAMP   NOT NULL DEFAULT now(),
        "isDeleted"                       boolean     NOT NULL DEFAULT false,
        "deleted_at"                      TIMESTAMPTZ,
        "deleted_by"                      uuid,
        "user_id"                         uuid        NOT NULL,
        "exercise_id"                     uuid        NOT NULL,
        "exercise_name"                   varchar(200),
        "workout_count"                   integer     NOT NULL DEFAULT 0,
        "total_volume_kg"                 double precision NOT NULL DEFAULT 0,
        "total_reps"                      bigint      NOT NULL DEFAULT 0,
        "first_performed_at"              TIMESTAMP,
        "last_performed_at"               TIMESTAMP,
        "best_weight_kg"                  double precision,
        "best_reps"                       integer,
        "best_volume_kg"                  double precision,
        "best_estimated_1rm_kg"           double precision,
        "best_distance_m"                 double precision,
        "best_time_seconds"               integer,
        "best_weight_workout_id"          uuid,
        "best_weight_workout_exercise_id" uuid,
        "best_weight_at"                  TIMESTAMP,
        "best_reps_workout_id"            uuid,
        "best_reps_workout_exercise_id"   uuid,
        "best_reps_at"                    TIMESTAMP,
        "best_volume_workout_id"          uuid,
        "best_volume_workout_exercise_id" uuid,
        "best_volume_at"                  TIMESTAMP,
        "best_1rm_workout_id"             uuid,
        "best_1rm_workout_exercise_id"    uuid,
        "best_1rm_at"                     TIMESTAMP,
        "best_distance_workout_id"        uuid,
        "best_distance_workout_exercise_id" uuid,
        "best_distance_at"               TIMESTAMP,
        "best_time_workout_id"            uuid,
        "best_time_workout_exercise_id"   uuid,
        "best_time_at"                    TIMESTAMP,
        "muscle_group"                    varchar(80),
        CONSTRAINT "PK_exercise_stats" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_exercise_stats_user_exercise"        ON "exercise_stats" ("user_id", "exercise_id")`);
    await queryRunner.query(`CREATE INDEX        IF NOT EXISTS "idx_exercise_stats_user_last_performed" ON "exercise_stats" ("user_id", "last_performed_at")`);

    // ── personal_records ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "personal_records" (
        "id"                  uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "created_at"          TIMESTAMP   NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP   NOT NULL DEFAULT now(),
        "isDeleted"           boolean     NOT NULL DEFAULT false,
        "deleted_at"          TIMESTAMPTZ,
        "deleted_by"          uuid,
        "user_id"             uuid        NOT NULL,
        "exercise_id"         uuid,
        "exercise_name"       varchar(200),
        "pr_type"             varchar(40) NOT NULL,
        "value"               double precision NOT NULL,
        "workout_id"          uuid        NOT NULL,
        "workout_exercise_id" uuid        NOT NULL,
        "achieved_at"         TIMESTAMP   NOT NULL,
        CONSTRAINT "PK_personal_records" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pr_user_achieved"        ON "personal_records" ("user_id", "achieved_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pr_user_exercise_type"   ON "personal_records" ("user_id", "exercise_id", "pr_type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_pr_achieved_at"          ON "personal_records" ("achieved_at")`);

    // ── progress_workout_queue ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "progress_workout_queue" (
        "id"           SERIAL      NOT NULL,
        "user_id"      uuid        NOT NULL,
        "workout_id"   uuid        NOT NULL,
        "reason"       varchar(20) NOT NULL DEFAULT 'modified',
        "status"       varchar(16) NOT NULL DEFAULT 'pending',
        "attempt_count" integer    NOT NULL DEFAULT 0,
        "last_error"   text,
        "processed_at" TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_progress_workout_queue" PRIMARY KEY ("id"),
        CONSTRAINT "uq_progress_queue_user_workout" UNIQUE ("user_id", "workout_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_progress_queue_status_created" ON "progress_workout_queue" ("status", "created_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "progress_workout_queue"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "personal_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "exercise_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workout_exercise_stats"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workout_stats"`);
  }
}
