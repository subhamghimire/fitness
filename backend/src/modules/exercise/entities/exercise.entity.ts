import { Entity, Column, Index } from "typeorm";
import { AbstractEntity } from "src/entities";


@Entity({ name: "exercises" })
export class Exercise extends AbstractEntity {
  // @Column({ type: "text", array: true, nullable: true })
  // images: string[]; // Deprecated in favor of files relation

  @Column({ type: "text", array: true, nullable: true })
  images: string[];

  @Column({ length: 150 })
  title: string;

  @Index({ unique: true })
  @Column({ length: 255 })
  slug: string;

  @Column({ type: "text" })
  description: string;
}
