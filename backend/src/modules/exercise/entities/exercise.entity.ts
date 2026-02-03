import { AbstractEntity } from "src/entities";
import { Entity, Column, Index } from "typeorm";

@Entity({ name: "exercises" })
export class Exercise extends AbstractEntity {
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
