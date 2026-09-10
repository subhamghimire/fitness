import { Entity, Column, Index, ManyToOne, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { UserTemplateExercise } from "./user-template-exercise.entity";

@Entity("user_template_sets")
export class UserTemplateSet extends AbstractEntity {
  @Index()
  @Column({ name: "template_exercise_id", type: "uuid" })
  templateExerciseId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "float", nullable: true })
  weight: number | null;

  @Column({ type: "int", nullable: true })
  reps: number | null;

  @Column({ name: "is_warmup", type: "boolean", default: false })
  isWarmup: boolean;

  @Column({ name: "is_dropset", type: "boolean", default: false })
  isDropset: boolean;

  @Column({ name: "is_failure", type: "boolean", default: false })
  isFailure: boolean;

  @Column({ type: "int", default: 1 })
  revision: number;

  @ManyToOne(() => UserTemplateExercise, (e) => e.sets, { onDelete: "CASCADE" })
  @JoinColumn({ name: "template_exercise_id" })
  templateExercise: UserTemplateExercise;
}
