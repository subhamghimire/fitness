import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Aligns the committed schema with the entities on databases built purely from
 * migrations (the real Supabase database already carries these objects, so
 * every statement below is idempotent):
 *
 * - `users.role` — declared on `User` (`@Column({ type: "enum", enum: UserRole })`)
 *   but no migration ever created the column or its enum type.
 * - `workout_templates` / `workout_template_exercises` / `workout_template_sets`
 *   `.id` — created without the `uuid_generate_v4()` default that
 *   `@PrimaryGeneratedColumn("uuid")` relies on for server-generated ids.
 */
export class AlignUsersRoleAndTemplateDefaults1789800000000 implements MigrationInterface {
  name = "AlignUsersRoleAndTemplateDefaults1789800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'users_role_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'admin');
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "public"."users_role_enum" NOT NULL DEFAULT 'user'`
    );

    await queryRunner.query(
      `ALTER TABLE "workout_templates" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`
    );
    await queryRunner.query(
      `ALTER TABLE "workout_template_exercises" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`
    );
    await queryRunner.query(
      `ALTER TABLE "workout_template_sets" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "workout_template_sets" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "workout_template_exercises" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "workout_templates" ALTER COLUMN "id" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."users_role_enum"`);
  }
}
