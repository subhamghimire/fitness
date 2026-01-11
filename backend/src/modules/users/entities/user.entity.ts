import { Entity, Column, OneToMany } from "typeorm";
import { Workout } from "../../workouts/entities/workout.entity";
import { AbstractEntity } from "src/entities";

@Entity("users")
export class User extends AbstractEntity {
  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @OneToMany(() => Workout, (w) => w.user)
  workouts: Workout[];
}
