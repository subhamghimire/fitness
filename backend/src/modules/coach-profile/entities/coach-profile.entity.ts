import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { CoachProfileVisibility } from "src/modules/coach/enums";
import { FileEntity } from "src/modules/files/entities/file.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from "typeorm";

export interface Certification {
  name: string;
  issuer?: string;
  year?: number;
}

@Entity({ name: "coach_profiles" })
export class CoachProfile extends AbstractEntity {
  @Index({ unique: true })
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @OneToOne(() => Coach, (coach) => coach.coachProfile, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ type: "text", nullable: true })
  bio: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  tagline: string | null;

  @Column({ type: "text", array: true, nullable: true })
  specialties: string[] | null;

  @Column({ name: "experience_years", type: "int", nullable: true })
  experienceYears: number | null;

  @Column({ type: "jsonb", nullable: true })
  certifications: Certification[] | null;

  @Column({ name: "website_url", type: "varchar", length: 255, nullable: true })
  websiteUrl: string | null;

  @Column({ name: "social_links", type: "jsonb", nullable: true })
  socialLinks: { label: string; url: string }[] | null;

  @Column({ name: "avatar_image_id", type: "uuid", nullable: true })
  avatarImageId: string | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "avatar_image_id" })
  avatarImage: FileEntity | null;

  @Column({ type: "enum", enum: CoachProfileVisibility, default: CoachProfileVisibility.PUBLIC })
  visibility: CoachProfileVisibility;

  @Column({ name: "average_rating", type: "numeric", precision: 3, scale: 2, default: 0 })
  averageRating: number;

  @Column({ name: "rating_count", type: "int", default: 0 })
  ratingCount: number;
}
