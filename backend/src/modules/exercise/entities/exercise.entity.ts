import { AbstractEntity } from "src/entities";
import { UserWorkout } from "src/modules/user-workout/entities/user-workout.entity";
import { Entity, Column, Index, OneToMany } from "typeorm";

@Entity({ name: "exercises" })
export class Exercise extends AbstractEntity {
  @Column({ type: "text", array: true, nullable: true })
  images: string[];

  @Column({ length: 150 })
  title: string;

  @Index({ unique: true })
  @Column({ length: 255 })
  slug: string;

  @Column({ type: "text" })
  description: string;

  @OneToMany(() => UserWorkout, (workout) => workout.exercise)
  userWorkouts: UserWorkout[];
}
