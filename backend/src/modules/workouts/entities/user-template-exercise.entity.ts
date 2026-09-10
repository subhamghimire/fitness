import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { UserTemplate } from "./user-template.entity";
import { UserTemplateSet } from "./user-template-set.entity";

@Entity("user_template_exercises")
export class UserTemplateExercise extends AbstractEntity {
  @Index()
  @Column({ name: "template_id", type: "uuid" })
  templateId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "int", default: 1 })
  revision: number;

  @ManyToOne(() => UserTemplate, (t) => t.exercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "template_id" })
  template: UserTemplate;

  @OneToMany(() => UserTemplateSet, (s) => s.templateExercise, { cascade: true })
  sets: UserTemplateSet[];
}
