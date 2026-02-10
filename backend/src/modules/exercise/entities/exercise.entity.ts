import { Entity, Column, Index, OneToMany } from "typeorm";
import { AbstractEntity } from "src/entities";
import { FileEntity } from "src/modules/files/entities/file.entity";

@Entity({ name: "exercises" })
export class Exercise extends AbstractEntity {
  @OneToMany(() => FileEntity, (file) => file.exercise, {
    cascade: true
  })
  images: FileEntity[];

  @Column({ length: 150 })
  title: string;

  @Index({ unique: true })
  @Column({ length: 255 })
  slug: string;

  @Column({ type: "text" })
  description: string;
}
