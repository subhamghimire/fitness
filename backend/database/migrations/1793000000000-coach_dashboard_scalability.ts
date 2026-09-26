import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Follow-up indexes for Phase 7 coach-dashboard reads.
 *
 * These are deliberately partial where the application always filters the
 * soft-delete columns. They complement (rather than replace) the broader
 * indexes from the initial relationship/progress migrations.
 *
 * Column order mirrors the entity `@Index` declarations exactly and is left
 * ASC: the dashboard orders by `... DESC`, which Postgres satisfies with a
 * backward index scan, and keeping the two in sync means a future
 * `migration:generate` sees no drift.
 *
 * Note the soft-delete columns keep their real names — `isDeleted` is an
 * unmapped property (camelCase) while `deleted_at` is explicitly mapped.
 *
 * Only indexes that add column coverage over what already exists are created.
 * A partial index is only worth its write cost when its predicate is actually
 * selective, so no `*_live` variant is added for `workout_stats` /
 * `personal_records`: `idx_workout_stats_user_started` and
 * `idx_pr_user_achieved` already have the same leading columns, and
 * `isDeleted = false AND deleted_at IS NULL` matches almost every row, so
 * those duplicates would be pure insert overhead on the busiest projections.
 */
export class CoachDashboardScalability1793000000000 implements MigrationInterface {
  name = "CoachDashboardScalability1793000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ccr_coach_live_started"
      ON "coach_client_relationships" ("coach_id", "status", "started_at", "id")
      WHERE "isDeleted" = false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ccr_coach_pending_created"
      ON "coach_client_relationships" ("coach_id", "created_at", "id")
      WHERE "isDeleted" = false AND "status" = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pa_coach_client_live_window"
      ON "program_assignments" ("coach_id", "client_id", "status", "is_active", "end_date")
      WHERE "isDeleted" = false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_wes_user_exercise_started_live"
      ON "workout_exercise_stats" ("user_id", "exercise_id", "started_at", "workout_id")
      WHERE "isDeleted" = false AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_exercise_stats_user_last_live"
      ON "exercise_stats" ("user_id", "last_performed_at", "exercise_id")
      WHERE "isDeleted" = false AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_exercise_stats_user_last_live"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_wes_user_exercise_started_live"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pa_coach_client_live_window"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ccr_coach_pending_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_ccr_coach_live_started"`);
  }
}
