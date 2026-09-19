import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Coach foundation (Phase 5).
 *
 * Replaces the single `is_verified` flag with explicit, separate concepts:
 *  - account status     (active / inactive / suspended)
 *  - coach eligibility  (eligible / ineligible)
 *  - verification state (pending / under_review / verified / rejected / expired)
 *
 * Adds the `coach_profiles`, `coach_verifications` tables and reworks
 * `coach_documents` so binaries are referenced through the files module
 * (`file_id`) instead of being embedded as `imageUrl`.
 *
 * `files.owner_id` records the uploader so that user-uploaded files become
 * private by default while catalog/system assets stay public.
 */
export class CoachFoundation1775000000000 implements MigrationInterface {
  name = "CoachFoundation1775000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── files: ownership for private-by-default user uploads ────────────────
    await queryRunner.query(`ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "owner_id" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_files_owner_id" ON "files" ("owner_id")`);

    // ── coaches: separate account / eligibility / verification state ────────
    await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN IF EXISTS "is_verified"`);
    await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN IF EXISTS "bio"`);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coaches_verification_status_enum') THEN
          CREATE TYPE "public"."coaches_verification_status_enum" AS ENUM('pending', 'under_review', 'verified', 'rejected', 'expired');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coaches_account_status_enum') THEN
          CREATE TYPE "public"."coaches_account_status_enum" AS ENUM('active', 'inactive', 'suspended');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coaches_eligibility_enum') THEN
          CREATE TYPE "public"."coaches_eligibility_enum" AS ENUM('eligible', 'ineligible');
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "verification_status" "public"."coaches_verification_status_enum" NOT NULL DEFAULT 'pending'`
    );
    await queryRunner.query(
      `ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "account_status" "public"."coaches_account_status_enum" NOT NULL DEFAULT 'active'`
    );
    await queryRunner.query(
      `ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "eligibility" "public"."coaches_eligibility_enum" NOT NULL DEFAULT 'eligible'`
    );

    // ── coach_documents: reference files module, add type, soft state ───────
    await queryRunner.query(`
      DO $$
      BEGIN
        BEGIN
          ALTER TYPE "public"."coach_documents_status_enum" ADD VALUE 'expired';
        EXCEPTION WHEN duplicate_object THEN null;
        END;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coach_documents_type_enum') THEN
          CREATE TYPE "public"."coach_documents_type_enum" AS ENUM('identification', 'certification', 'proof_of_experience', 'other');
        END IF;
      END $$;
    `);

    await queryRunner.query(`ALTER TABLE "coach_documents" DROP COLUMN IF EXISTS "imageUrl"`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'coach_documents' AND column_name = 'coachId'
        ) THEN
          ALTER TABLE "coach_documents" RENAME COLUMN "coachId" TO "coach_id";
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "coach_documents" ADD COLUMN IF NOT EXISTS "type" "public"."coach_documents_type_enum" NOT NULL DEFAULT 'other'`
    );
    await queryRunner.query(`ALTER TABLE "coach_documents" ADD COLUMN IF NOT EXISTS "file_id" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_coach_documents_file_id" ON "coach_documents" ("file_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_COACH_DOC_BADGES" ON "coach_documents" USING GIN ("badges")`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_coach_documents_file') THEN
          ALTER TABLE "coach_documents"
          ADD CONSTRAINT "FK_coach_documents_file"
          FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // ── coach_profiles ──────────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coach_profiles_visibility_enum') THEN
          CREATE TYPE "public"."coach_profiles_visibility_enum" AS ENUM('public', 'private');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coach_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "coach_id" uuid NOT NULL,
        "bio" text,
        "tagline" character varying(100),
        "specialties" text array,
        "experience_years" integer,
        "certifications" jsonb,
        "website_url" character varying(255),
        "social_links" jsonb,
        "avatar_image_id" uuid,
        "visibility" "public"."coach_profiles_visibility_enum" NOT NULL DEFAULT 'public',
        "average_rating" numeric(3,2) NOT NULL DEFAULT 0,
        "rating_count" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_coach_profiles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coach_profiles_coach_id" ON "coach_profiles" ("coach_id")`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_coach_profiles_coach') THEN
          ALTER TABLE "coach_profiles"
          ADD CONSTRAINT "FK_coach_profiles_coach"
          FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_coach_profiles_avatar') THEN
          ALTER TABLE "coach_profiles"
          ADD CONSTRAINT "FK_coach_profiles_avatar"
          FOREIGN KEY ("avatar_image_id") REFERENCES "files"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ── coach_verifications ─────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coach_verifications_status_enum') THEN
          CREATE TYPE "public"."coach_verifications_status_enum" AS ENUM('pending', 'under_review', 'verified', 'rejected', 'expired');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "coach_verifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "deleted_by" uuid,
        "coach_id" uuid NOT NULL,
        "status" "public"."coach_verifications_status_enum" NOT NULL DEFAULT 'pending',
        "submitted_at" TIMESTAMP WITH TIME ZONE,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "reviewed_by" uuid,
        "decision_note" text,
        "expires_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_coach_verifications" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_coach_verifications_coach_id" ON "coach_verifications" ("coach_id")`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_coach_verifications_coach') THEN
          ALTER TABLE "coach_verifications"
          ADD CONSTRAINT "FK_coach_verifications_coach"
          FOREIGN KEY ("coach_id") REFERENCES "coaches"("id") ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "coach_verifications"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coach_verifications_status_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "coach_profiles"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coach_profiles_visibility_enum"`);

    await queryRunner.query(`ALTER TABLE "coach_documents" DROP CONSTRAINT IF EXISTS "FK_coach_documents_file"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_COACH_DOC_BADGES"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_coach_documents_file_id"`);
    await queryRunner.query(`ALTER TABLE "coach_documents" DROP COLUMN IF EXISTS "file_id"`);
    await queryRunner.query(`ALTER TABLE "coach_documents" DROP COLUMN IF EXISTS "type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coach_documents_type_enum"`);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'coach_documents' AND column_name = 'coach_id'
        ) THEN
          ALTER TABLE "coach_documents" RENAME COLUMN "coach_id" TO "coachId";
        END IF;
      END $$;
    `);
    await queryRunner.query(`ALTER TABLE "coach_documents" ADD COLUMN IF NOT EXISTS "imageUrl" character varying NOT NULL DEFAULT ''`);

    await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN IF EXISTS "eligibility"`);
    await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN IF EXISTS "account_status"`);
    await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN IF EXISTS "verification_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coaches_eligibility_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coaches_account_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."coaches_verification_status_enum"`);
    await queryRunner.query(`ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "bio" text`);
    await queryRunner.query(`ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "is_verified" boolean NOT NULL DEFAULT false`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_files_owner_id"`);
    await queryRunner.query(`ALTER TABLE "files" DROP COLUMN IF EXISTS "owner_id"`);
  }
}
