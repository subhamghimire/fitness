import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "../../users/entities/user.entity";
import { UserTemplateExercise } from "./user-template-exercise.entity";

@Entity("user_templates")
export class UserTemplate extends AbstractEntity {
  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "int", default: 1 })
  revision: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @OneToMany(() => UserTemplateExercise, (e) => e.template, { cascade: true })
  exercises: UserTemplateExercise[];
}
