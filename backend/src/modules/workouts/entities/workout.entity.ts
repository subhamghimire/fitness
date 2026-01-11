import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { User } from "../../users/entities/user.entity";
import { Exercise } from "./exercise.entity";
import { AbstractEntity } from "src/entities";

@Entity("workouts")
export class Workout extends AbstractEntity {
  @Column("char", { name: "user_id" }) userId: string;

  @Column({ name: "started_at", type: "timestamp" })
  startedAt: Date;
  @Column({ name: "ended_at", type: "timestamp", nullable: true })
  endedAt: Date | null;

  @ManyToOne(() => User, (u) => u.workouts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @OneToMany(() => Exercise, (e) => e.workout, { cascade: true })
  exercises: Exercise[];
}
