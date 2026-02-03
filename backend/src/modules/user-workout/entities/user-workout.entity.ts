import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { Exercise } from "src/modules/exercise/entities/exercise.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";

@Entity({ name: "user_workouts" })
export class UserWorkout extends AbstractEntity {
  @Column({ type: "text", nullable: true })
  notes: string;

  @Index()
  @Column({ type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Index()
  @Column({ type: "uuid" })
  exerciseId: string;

  @ManyToOne(() => Exercise, { onDelete: "CASCADE" })
  @JoinColumn({ name: "exerciseId" })
  exercise: Exercise;
}
