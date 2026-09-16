import { Entity, Column, Index, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { AbstractEntity } from "src/entities";
import { WorkoutTemplate } from "./workout-template.entity";
import { WorkoutTemplateSet } from "./workout-template-set.entity";
import { Exercise } from "../../exercise/entities/exercise.entity";

/**
 * TEMPLATE EXERCISE — an exercise inside a planned workout template.
 *
 * `exercise_id` is an optional reference to the reusable exercise catalog;
 * `name` is the denormalized display name so templates keep working even when
 * the catalog entry is later removed or soft-deleted.
 */
@Entity("workout_template_exercises")
export class WorkoutTemplateExercise extends AbstractEntity {
  @Index()
  @Column({ name: "template_id", type: "uuid" })
  templateId: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "exercise_id", type: "uuid", nullable: true })
  exerciseId: string | null;

  @Column({ type: "varchar", length: 200 })
  name: string;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ name: "rest_seconds", type: "int", nullable: true })
  restSeconds: number | null;

  @Column({ type: "int", default: 1 })
  revision: number;

  /** Logical time of the last client mutation; used for conflict resolution. */
  @Column({ name: "client_updated_at", type: "timestamptz", nullable: true })
  clientUpdatedAt: Date | null;

  @ManyToOne(() => WorkoutTemplate, (t) => t.exercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "template_id" })
  template: WorkoutTemplate;

  @ManyToOne(() => Exercise, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise | null;

  @OneToMany(() => WorkoutTemplateSet, (s) => s.templateExercise, { cascade: true })
  sets: WorkoutTemplateSet[];
}
