import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { User } from "../../users/entities/user.entity";
import { WorkoutTemplateExercise } from "./workout-template-exercise.entity";

/**
 * WORKOUT TEMPLATE — a planned workout structure a user can repeat.
 */
@Entity("workout_templates")
export class WorkoutTemplate extends AbstractEntity {
  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ type: "int", default: 1 })
  revision: number;

  /** Logical time of the last client mutation; used for conflict resolution. */
  @Column({ name: "client_updated_at", type: "timestamptz", nullable: true })
  clientUpdatedAt: Date | null;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @OneToMany(() => WorkoutTemplateExercise, (e) => e.template, { cascade: true })
  exercises: WorkoutTemplateExercise[];
}
