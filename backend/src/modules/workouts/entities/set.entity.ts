import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Exercise } from "./exercise.entity";
import { AbstractEntity } from "src/entities";

@Entity("sets")
export class Set extends AbstractEntity {
  @Column("char", { name: "exercise_id" })
  exerciseId: string;

  @Column({ type: "float", nullable: true })
  weight?: number | null;

  @Column({ type: "int", nullable: true })
  reps?: number | null;

  @Column({ type: "int", nullable: true })
  rpe?: number | null;

  @Column({ name: "is_warmup", type: "boolean", default: false })
  isWarmup: boolean;

  @ManyToOne(() => Exercise, (e) => e.sets, { onDelete: "CASCADE" })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise;
}
