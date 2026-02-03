import { Entity, Column, ManyToOne, OneToMany, JoinColumn, Index } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Workout } from "./workout.entity";
import { Exercise } from "../../exercise/entities/exercise.entity";
import { Set } from "./set.entity";

@Entity("workout_exercises")
export class WorkoutExercise extends AbstractEntity {
  @Index()
  @Column({ name: "workout_id", type: "uuid" })
  workoutId: string;

  @Index()
  @Column({ name: "exercise_id", type: "uuid" })
  exerciseId: string;

  @Column({ name: "order_index", type: "int", default: 0 })
  orderIndex: number;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ name: "rest_seconds", type: "int", nullable: true })
  restSeconds: number | null;

  @ManyToOne(() => Workout, (w) => w.workoutExercises, { onDelete: "CASCADE" })
  @JoinColumn({ name: "workout_id" })
  workout: Workout;

  @ManyToOne(() => Exercise, { onDelete: "CASCADE" })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise;

  @OneToMany(() => Set, (s) => s.workoutExercise, { cascade: true })
  sets: Set[];
}
