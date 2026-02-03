import { MigrationInterface, QueryRunner } from "typeorm";

export class AddColumnInUsers1770135441673 implements MigrationInterface {
    name = 'AddColumnInUsers1770135441673'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "coaches" ADD "user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "coaches" ADD CONSTRAINT "UQ_bd9923ac72efde2d5895e118fa8" UNIQUE ("user_id")`);
        await queryRunner.query(`ALTER TABLE "coaches" ADD CONSTRAINT "FK_bd9923ac72efde2d5895e118fa8" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "coaches" DROP CONSTRAINT "FK_bd9923ac72efde2d5895e118fa8"`);
        await queryRunner.query(`ALTER TABLE "coaches" DROP CONSTRAINT "UQ_bd9923ac72efde2d5895e118fa8"`);
        await queryRunner.query(`ALTER TABLE "coaches" DROP COLUMN "user_id"`);
    }

}
