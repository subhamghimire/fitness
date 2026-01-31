import { MigrationInterface, QueryRunner } from "typeorm";

export class InitMigrations1769876780088 implements MigrationInterface {
    name = 'InitMigrations1769876780088'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."coach_documents_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "coach_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "imageUrl" character varying NOT NULL, "title" character varying(150) NOT NULL, "status" "public"."coach_documents_status_enum" NOT NULL DEFAULT 'pending', "badges" text array, "coachId" uuid NOT NULL, CONSTRAINT "PK_6985a3b98626314fcb658c18714" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9557902de444d6178909a7b5d0" ON "coach_documents" ("coachId") `);
        await queryRunner.query(`CREATE TABLE "coaches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "name" character varying(100) NOT NULL, "is_verified" boolean NOT NULL DEFAULT false, "bio" text, "rank" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_eddaece1a1f1b197fa39e6864a1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "coach_ratings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "coachId" uuid NOT NULL, "userId" uuid NOT NULL, "rating_no" integer NOT NULL, "comment" text, CONSTRAINT "PK_794da4f240f270ca80e71751dd6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1971449927e48324102e7b3714" ON "coach_ratings" ("coachId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9bd8cdaf500b503c17a48c5fa1" ON "coach_ratings" ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c0e2e5ad1946f07cab640ec7e5" ON "coach_ratings" ("coachId", "userId") `);
        await queryRunner.query(`CREATE TABLE "sets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "exercise_id" uuid NOT NULL, "weight" double precision, "reps" integer, "rpe" integer, "is_warmup" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_5d15ed8b3e2a5cb6e9c9921d056" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "exercises" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "workout_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "order_index" integer NOT NULL, CONSTRAINT "PK_c4c46f5fa89a58ba7c2d894e3c3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_workouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "notes" text, "userId" uuid NOT NULL, "exerciseId" uuid NOT NULL, CONSTRAINT "PK_a1641f2705c5e47819a43dbb261" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7e345f9b406fa39c6cfb3f2219" ON "user_workouts" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_0116da835836711bd438507091" ON "user_workouts" ("exerciseId") `);
        await queryRunner.query(`CREATE TYPE "public"."users_gender_enum" AS ENUM('male', 'female', 'other')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "name" character varying(100) NOT NULL, "email" character varying(150) NOT NULL, "password" character varying NOT NULL, "age" integer, "gender" "public"."users_gender_enum", "avatar" character varying, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TABLE "workouts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "user_id" uuid NOT NULL, "started_at" TIMESTAMP NOT NULL, "ended_at" TIMESTAMP, CONSTRAINT "PK_5b2319bf64a674d40237dbb1697" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."coach_templates_discounttype_enum" AS ENUM('percentage', 'amount')`);
        await queryRunner.query(`CREATE TYPE "public"."coach_templates_type_enum" AS ENUM('template', 'program')`);
        await queryRunner.query(`CREATE TABLE "coach_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "title" character varying(150) NOT NULL, "price" numeric(10,2) NOT NULL, "discount" numeric(10,2), "discountType" "public"."coach_templates_discounttype_enum", "type" "public"."coach_templates_type_enum" NOT NULL, "coachId" uuid NOT NULL, CONSTRAINT "PK_ae8f9a50ead6ddd97481dce9848" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ed140dff2053f89f961fdc233b" ON "coach_templates" ("coachId") `);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "workout_id"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "order_index"`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "workout_id" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "name" character varying(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "order_index" integer NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "images" text array`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "title" character varying(150) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "slug" character varying(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "description" text NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_39b440305ccf965ef366de53ab" ON "exercises" ("slug") `);
        await queryRunner.query(`ALTER TABLE "coach_documents" ADD CONSTRAINT "FK_9557902de444d6178909a7b5d07" FOREIGN KEY ("coachId") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coach_ratings" ADD CONSTRAINT "FK_1971449927e48324102e7b37145" FOREIGN KEY ("coachId") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coach_ratings" ADD CONSTRAINT "FK_9bd8cdaf500b503c17a48c5fa11" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sets" ADD CONSTRAINT "FK_6e1ca3ee24c9f4002d402e71b68" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD CONSTRAINT "FK_7b0c9579a1c0ef6d5bd42f83282" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_workouts" ADD CONSTRAINT "FK_7e345f9b406fa39c6cfb3f2219a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_workouts" ADD CONSTRAINT "FK_0116da835836711bd4385070917" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "workouts" ADD CONSTRAINT "FK_2df679279a7ac263bcff20c78dd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "coach_templates" ADD CONSTRAINT "FK_ed140dff2053f89f961fdc233b3" FOREIGN KEY ("coachId") REFERENCES "coaches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "coach_templates" DROP CONSTRAINT "FK_ed140dff2053f89f961fdc233b3"`);
        await queryRunner.query(`ALTER TABLE "workouts" DROP CONSTRAINT "FK_2df679279a7ac263bcff20c78dd"`);
        await queryRunner.query(`ALTER TABLE "user_workouts" DROP CONSTRAINT "FK_0116da835836711bd4385070917"`);
        await queryRunner.query(`ALTER TABLE "user_workouts" DROP CONSTRAINT "FK_7e345f9b406fa39c6cfb3f2219a"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP CONSTRAINT "FK_7b0c9579a1c0ef6d5bd42f83282"`);
        await queryRunner.query(`ALTER TABLE "sets" DROP CONSTRAINT "FK_6e1ca3ee24c9f4002d402e71b68"`);
        await queryRunner.query(`ALTER TABLE "coach_ratings" DROP CONSTRAINT "FK_9bd8cdaf500b503c17a48c5fa11"`);
        await queryRunner.query(`ALTER TABLE "coach_ratings" DROP CONSTRAINT "FK_1971449927e48324102e7b37145"`);
        await queryRunner.query(`ALTER TABLE "coach_documents" DROP CONSTRAINT "FK_9557902de444d6178909a7b5d07"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_39b440305ccf965ef366de53ab"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "description"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "slug"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "title"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "images"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "order_index"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "workout_id"`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "order_index" integer NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "name" character varying(255) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "workout_id" uuid NOT NULL`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ed140dff2053f89f961fdc233b"`);
        await queryRunner.query(`DROP TABLE "coach_templates"`);
        await queryRunner.query(`DROP TYPE "public"."coach_templates_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."coach_templates_discounttype_enum"`);
        await queryRunner.query(`DROP TABLE "workouts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_gender_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0116da835836711bd438507091"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7e345f9b406fa39c6cfb3f2219"`);
        await queryRunner.query(`DROP TABLE "user_workouts"`);
        await queryRunner.query(`DROP TABLE "exercises"`);
        await queryRunner.query(`DROP TABLE "sets"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c0e2e5ad1946f07cab640ec7e5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9bd8cdaf500b503c17a48c5fa1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1971449927e48324102e7b3714"`);
        await queryRunner.query(`DROP TABLE "coach_ratings"`);
        await queryRunner.query(`DROP TABLE "coaches"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9557902de444d6178909a7b5d0"`);
        await queryRunner.query(`DROP TABLE "coach_documents"`);
        await queryRunner.query(`DROP TYPE "public"."coach_documents_status_enum"`);
    }

}
