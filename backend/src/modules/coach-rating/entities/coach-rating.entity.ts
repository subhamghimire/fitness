import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn } from "typeorm";

@Entity({ name: "coach_ratings" })
@Index(["coachId", "userId"], { unique: true }) // one rating per user per coach
export class CoachRating extends AbstractEntity {
  @Index()
  @Column({ type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coachId" })
  coach: Coach;

  @Index()
  @Column({ type: "uuid" })
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "int", name: "rating_no" })
  ratingNo: number;

  @Column({ type: "text", nullable: true })
  comment: string;
}
