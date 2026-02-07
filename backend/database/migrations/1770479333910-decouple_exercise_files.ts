import { MigrationInterface, QueryRunner } from "typeorm";

export class DecoupleExerciseFiles1770479333910 implements MigrationInterface {
    name = 'DecoupleExerciseFiles1770479333910'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_9d66299d3b368984c2f1bb5302c"`);
        await queryRunner.query(`ALTER TABLE "files" DROP COLUMN "exerciseId"`);
        await queryRunner.query(`ALTER TABLE "exercises" ADD "images" text array`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "exercises" DROP COLUMN "images"`);
        await queryRunner.query(`ALTER TABLE "files" ADD "exerciseId" uuid`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_9d66299d3b368984c2f1bb5302c" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

}
