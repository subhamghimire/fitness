import { AbstractEntity } from "src/entities";
import { CoachDocument } from "src/modules/coach-document/entities/coach-document.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Column, Entity, OneToMany, OneToOne, JoinColumn } from "typeorm";

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

  @OneToOne(() => User, (user) => user.coachProfile, { nullable: true })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "user_id", nullable: true })
  userId: string;
}
