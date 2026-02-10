import { MigrationInterface, QueryRunner } from "typeorm";

export class FileWithExercise1770734108429 implements MigrationInterface {
    name = 'FileWithExercise1770734108429'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "images"`);
        await queryRunner.query(`ALTER TABLE "files" ADD "exercise_id" uuid`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_d206f1d913260b87ee6ad293143" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_d206f1d913260b87ee6ad293143"`);
        await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "exercise_id"`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "images" text array`);
    }

}
