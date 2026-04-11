import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGooglePhotoUrlToUsers1771000000000 implements MigrationInterface {
    name = 'AddGooglePhotoUrlToUsers1771000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "google_photo_url" character varying(500)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_photo_url"`);
    }
}

