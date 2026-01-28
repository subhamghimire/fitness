import { AbstractEntity } from "src/entities";
import { Entity, Column, CreateDateColumn, UpdateDateColumn, Index, JoinColumn, ManyToOne } from "typeorm";
import { CoachDocumentStatus } from "../enums";
import { Coach } from "src/modules/coach/entities/coach.entity";

@Entity({ name: "coach_documents" })
export class CoachDocument extends AbstractEntity {
  @Column()
  imageUrl: string;

  @Column({ length: 150 })
  title: string;

  @Column({ type: "enum", enum: CoachDocumentStatus, default: CoachDocumentStatus.PENDING })
  status: CoachDocumentStatus;

  @Index("IDX_COACH_DOC_BADGES", { synchronize: false })
  @Column({ type: "text", array: true, nullable: true })
  badges: string[];

  @Index()
  @Column({ type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, (coach) => coach.documents, {
    onDelete: "CASCADE"
  })
  @JoinColumn({ name: "coachId" })
  coach: Coach;
}
