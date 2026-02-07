import { MigrationInterface, QueryRunner } from "typeorm";

export class FilesTable1770479017845 implements MigrationInterface {
    name = 'FilesTable1770479017845'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "isDeleted" boolean NOT NULL DEFAULT false, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "originalName" character varying NOT NULL, "filename" character varying NOT NULL, "mimetype" character varying NOT NULL, "path" character varying NOT NULL, "size" integer NOT NULL, "type" character varying NOT NULL DEFAULT 'misc', "exerciseId" uuid, CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_9d66299d3b368984c2f1bb5302c" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_9d66299d3b368984c2f1bb5302c"`);
        await queryRunner.query(`DROP TABLE "files"`);
    }

}
