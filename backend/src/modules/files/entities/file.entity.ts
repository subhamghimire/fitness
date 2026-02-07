import { Entity, Column } from "typeorm";
import { AbstractEntity } from "src/entities";
import { ApiProperty } from "@nestjs/swagger";

import { FileFolder } from "../enums/file-folder.enum";

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


}
