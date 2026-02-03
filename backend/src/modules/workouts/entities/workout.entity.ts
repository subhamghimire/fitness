import { Entity, Column, ManyToOne, OneToMany, JoinColumn, Index } from "typeorm";
import { User } from "../../users/entities/user.entity";
import { WorkoutExercise } from "./workout-exercise.entity";
import { AbstractEntity } from "src/entities";

@Entity("workouts")
export class Workout extends AbstractEntity {
  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ type: "varchar", length: 150, nullable: true })
  name: string | null;

  @Column({ type: "text", nullable: true })
  notes: string | null;

  @Column({ name: "started_at", type: "timestamp" })
  startedAt: Date;

  @Column({ name: "ended_at", type: "timestamp", nullable: true })
  endedAt: Date | null;

  @Column({ name: "duration_seconds", type: "int", nullable: true })
  durationSeconds: number | null;

  @ManyToOne(() => User, (u) => u.workouts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @OneToMany(() => WorkoutExercise, (we) => we.workout, { cascade: true })
  workoutExercises: WorkoutExercise[];
}
