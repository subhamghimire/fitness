import { AbstractEntity } from "src/entities";
import { CoachAccountStatus, CoachEligibility, CoachVerificationStatus } from "../enums";
import { CoachDocument } from "src/modules/coach-document/entities/coach-document.entity";
import { CoachProfile } from "src/modules/coach-profile/entities/coach-profile.entity";
import { CoachVerification } from "src/modules/coach-verification/entities/coach-verification.entity";
import { User } from "src/modules/users/entities/user.entity";
import { Column, Entity, OneToMany, OneToOne, JoinColumn } from "typeorm";

@Entity("coaches")
export class Coach extends AbstractEntity {
  @Column({ length: 100 })
  name: string;

  @Column({
    name: "verification_status",
    type: "enum",
    enum: CoachVerificationStatus,
    default: CoachVerificationStatus.PENDING
  })
  verificationStatus: CoachVerificationStatus;

  @Column({
    name: "account_status",
    type: "enum",
    enum: CoachAccountStatus,
    default: CoachAccountStatus.ACTIVE
  })
  accountStatus: CoachAccountStatus;

  @Column({
    type: "enum",
    enum: CoachEligibility,
    default: CoachEligibility.ELIGIBLE
  })
  eligibility: CoachEligibility;

  @Column({ type: "int", default: 0 })
  rank: number;

  @OneToMany(() => CoachDocument, (doc) => doc.coach)
  documents: CoachDocument[];

  @OneToOne(() => CoachProfile, (profile) => profile.coach, { cascade: true })
  coachProfile: CoachProfile;

  @OneToOne(() => CoachVerification, (verification) => verification.coach, { cascade: true })
  coachVerification: CoachVerification;

  @OneToOne(() => User, (user) => user.coachProfile, { nullable: true })
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "user_id", nullable: true })
  userId: string;
}
