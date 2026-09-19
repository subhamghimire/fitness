import { Entity, Column, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { ApiProperty } from "@nestjs/swagger";

import { FileFolder } from "../enums/file-folder.enum";
import { Exercise } from "src/modules/exercise/entities/exercise.entity";

@Entity("files")
export class FileEntity extends AbstractEntity {
  @ApiProperty()
  @Column()
  originalName: string;

  @ApiProperty()
  @Column()
  filename: string;

  @ApiProperty()
  @Column()
  mimetype: string;

  @ApiProperty()
  @Column()
  path: string;

  @ApiProperty()
  @Column({ type: "int" })
  size: number;

  @ApiProperty({ enum: FileFolder })
  @Column({ default: FileFolder.MISC })
  type: FileFolder;

  @ApiProperty({ description: "Uploader user id. Files without an owner are treated as public." })
  @Column({ name: "owner_id", type: "uuid", nullable: true })
  ownerId: string | null;

  @ManyToOne(() => Exercise, (exercise) => exercise.images, {
    onDelete: "CASCADE"
  })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise;
}
