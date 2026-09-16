import { AbstractEntity } from "src/entities";
import { User } from "src/modules/users/entities/user.entity";
import { Exercise } from "src/modules/exercise/entities/exercise.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";

@Entity("favorite_exercises")
@Index(["userId", "exerciseId"], { unique: true })
export class FavoriteExercise extends AbstractEntity {
  @Column({ type: "text", nullable: true })
  notes: string;

  @Index()
  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Index()
  @Column({ name: "exercise_id", type: "uuid" })
  exerciseId: string;

  @ManyToOne(() => Exercise, { onDelete: "CASCADE" })
  @JoinColumn({ name: "exercise_id" })
  exercise: Exercise;
}
