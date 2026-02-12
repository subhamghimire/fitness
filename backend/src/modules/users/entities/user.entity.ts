import { Entity, Column, OneToMany, Index, OneToOne, JoinColumn } from "typeorm";
import { Workout } from "../../workouts/entities/workout.entity";
import { AbstractEntity } from "src/entities";
import { Gender } from "../enums";
import { CoachRating } from "src/modules/coach-rating/entities/coach-rating.entity";
import { UserWorkout } from "src/modules/user-workout/entities/user-workout.entity";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { FileEntity } from "src/modules/files/entities/file.entity";

@Entity("users")
export class User extends AbstractEntity {
  @Column({ length: 100 })
  name: string;

  @Index({ unique: true })
  @Column({ length: 150 })
  email: string;

  @Column({ select: false })
  password: string;

  @Column({ type: "int", nullable: true })
  age: number;

  @Column({ type: "enum", enum: Gender, nullable: true })
  gender: Gender;

  @OneToOne(() => FileEntity, { nullable: true, cascade: true, eager: true })
  @JoinColumn({ name: "avatar_id" })
  avatar: FileEntity;

  @OneToMany(() => Workout, (w) => w.user)
  workouts: Workout[];

  @OneToMany(() => CoachRating, (rating) => rating.user)
  coachRatings: CoachRating[];

  @OneToMany(() => UserWorkout, (workout) => workout.user)
  userWorkouts: UserWorkout[];

  @OneToOne(() => Coach, (coach) => coach.user)
  coachProfile: Coach;
}
