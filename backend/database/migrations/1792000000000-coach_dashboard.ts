import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * PHASE 7 — COACH DASHBOARD.
 *
 * Adds the composite indexes that back the coach-dashboard read queries:
 *
 *   - `idx_coach_client_relationships_coach_status`
 *     serves the dominant `coach_id = ? AND status IN (...) AND isDeleted = false`
 *     scoping pattern (overview, client list, pending requests, activity feed).
 *   - `idx_program_assignments_coach_status`
 *     serves assignment-metric loads (`coach_id = ? AND client_id IN (...)
 *     AND is_active = true`), letting Postgres narrow by coach first.
 *
 * Both are idempotent (IF NOT EXISTS) so they apply cleanly anywhere.
 */
export class CoachDashboard1792000000000 implements MigrationInterface {
  name = "CoachDashboard1792000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_coach_client_relationships_coach_status" ON "coach_client_relationships" ("coach_id", "status")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_program_assignments_coach_status" ON "program_assignments" ("coach_id", "status")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_program_assignments_coach_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_coach_client_relationships_coach_status"`);
  }
}