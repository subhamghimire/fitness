import { AbstractEntity } from "src/entities";
import { CoachDocument } from "src/modules/coach-document/entities/coach-document.entity";
import { Column, Entity, OneToMany } from "typeorm";

@Entity("coaches")
export class Coach extends AbstractEntity {
  @Column({ length: 100 })
  name: string;

  @Column({ default: false, name: "is_verified" })
  isVerified: boolean;

  @Column({ type: "text", nullable: true })
  bio: string;

  @Column({ type: "int", default: 0 })
  rank: number;

  @OneToMany(() => CoachDocument, (doc) => doc.coach)
  documents: CoachDocument[];
}
