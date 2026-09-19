import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * PHASE 6 — COACH-CLIENT RELATIONSHIPS AND PROGRAMS.
 *
 * Creates the explicit coach-client relationship domain plus the program domain
 * (Program / ProgramDay / ProgramWorkout / ProgramAssignment).
 *
 * History preservation is enforced by schema too, not just service code:
 *
 *   - `coach_client_relationships` keeps one row per relationship generation.
 *     The partial unique index `uq_coach_client_live_relationship` guarantees a
 *     single LIVE row (pending/active/paused) per (coach_id, client_id) pair,
 *     while ENDED/BLOCKED rows are never touched and re-inviting a former client
 *     inserts a brand new row.
 *   - `program_assignments` mirrors the same rule: the partial unique index
 *     `uq_program_assignments_live` permits at most one LIVE (is_active = true)
 *     assignment per (program_id, client_id); COMPLETED/CANCELLED assignments
 *     are frozen forever.
 *
 * All statements are idempotent (IF NOT EXISTS) so they apply cleanly on any
 * database, regardless of whether previous migrations already created objects.
 */
export class CoachClientPrograms1790000000000 implements MigrationInterface {
  name = "CoachClientPrograms1790000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── enum types ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'coach_relationship_status_enum' AND n.nspname = 'public') THEN
          CREATE TYPE "public"."coach_relationship_status_enum" AS ENUM('pending', 'active', 'paused', 'ended', 'blocked');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'program_assignment_status_enum' AND n.nspname = 'public') THEN
          CREATE TYPE "public"."program_assignment_status_enum" AS ENUM('upcoming', 'active', 'completed', 'cancelled');
        END IF;
      END $$;
    `);

    // ── coach_client_relationships ───────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coach_client_relationships" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "coach_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "status" "public"."coach_relationship_status_enum" NOT NULL DEFAULT 'pending',
        "started_at" TIMESTAMPTZ,
        "ended_at" TIMESTAMPTZ,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_ccr_coach" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ccr_client" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_coach_client_relationships_coach" ON "coach_client_relationships" ("coach_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_coach_client_relationships_client" ON "coach_client_relationships" ("client_id")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_coach_client_live_relationship"
      ON "coach_client_relationships" ("coach_id", "client_id")
      WHERE ("status" IN ('pending', 'active', 'paused'))
    `);

    // ── programs ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "programs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "coach_id" uuid NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_programs_coach" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_programs_coach" ON "programs" ("coach_id")`);

    // ── program_days ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "program_days" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "program_id" uuid NOT NULL,
        "week_number" integer NOT NULL DEFAULT 1,
        "day_number" integer NOT NULL DEFAULT 1,
        "order_index" integer NOT NULL DEFAULT 0,
        "name" character varying(200),
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_program_days_program" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_program_days_program"
      ON "program_days" ("program_id", "week_number", "day_number", "order_index")
    `);

    // ── program_workouts ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "program_workouts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "program_day_id" uuid NOT NULL,
        "workout_template_id" uuid NOT NULL,
        "name" character varying(200),
        "order_index" integer NOT NULL DEFAULT 0,
        "notes" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_pw_program_day" FOREIGN KEY ("program_day_id") REFERENCES "program_days"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pw_workout_template" FOREIGN KEY ("workout_template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_program_workouts_program_day" ON "program_workouts" ("program_day_id", "order_index")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_program_workouts_template" ON "program_workouts" ("workout_template_id")`);

    // ── program_assignments ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "program_assignments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "program_id" uuid NOT NULL,
        "coach_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "start_date" TIMESTAMPTZ NOT NULL,
        "end_date" TIMESTAMPTZ,
        "status" "public"."program_assignment_status_enum" NOT NULL DEFAULT 'upcoming',
        "is_active" boolean NOT NULL DEFAULT true,
        "started_at" TIMESTAMPTZ,
        "ended_at" TIMESTAMPTZ,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMPTZ,
        "deleted_by" uuid,
        CONSTRAINT "fk_pa_program" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pa_coach" FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pa_client" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_program_assignments_program" ON "program_assignments" ("program_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_program_assignments_coach" ON "program_assignments" ("coach_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_program_assignments_client" ON "program_assignments" ("client_id")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_program_assignments_live"
      ON "program_assignments" ("program_id", "client_id")
      WHERE ("is_active" = true)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "program_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "program_workouts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "program_days"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "programs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "coach_client_relationships"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."program_assignment_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coach_relationship_status_enum"`);
  }
}