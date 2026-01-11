import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { Workout } from "./workout.entity";
import { Set } from "./set.entity";
import { AbstractEntity } from "src/entities";

@Entity("exercises")
export class Exercise extends AbstractEntity {
  @Column("char", { name: "workout_id" })
  workoutId: string;

  @Column({ length: 255 })
  name: string;

  @Column({ name: "order_index", type: "int" })
  orderIndex: number;

  @ManyToOne(() => Workout, (w) => w.exercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_id" })
  workout: Workout;

  @OneToMany(() => Set, (s) => s.exercise, { cascade: true })
  sets: Set[];
}
