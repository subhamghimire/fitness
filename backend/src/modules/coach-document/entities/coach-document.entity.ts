import { AbstractEntity } from "src/entities";
import { Entity, Column, Index, JoinColumn, ManyToOne } from "typeorm";
import { CoachDocumentStatus, CoachDocumentType } from "../enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { FileEntity } from "src/modules/files/entities/file.entity";

@Entity({ name: "coach_documents" })
export class CoachDocument extends AbstractEntity {
  @Column({ length: 150 })
  title: string;

  @Column({ type: "enum", enum: CoachDocumentStatus, default: CoachDocumentStatus.PENDING })
  status: CoachDocumentStatus;

  @Column({ type: "enum", enum: CoachDocumentType, default: CoachDocumentType.OTHER })
  type: CoachDocumentType;

  @Index("IDX_COACH_DOC_BADGES", { synchronize: false })
  @Column({ type: "text", array: true, nullable: true })
  badges: string[] | null;

  @Index()
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, (coach) => coach.documents, {
    onDelete: "CASCADE"
  })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Index()
  @Column({ name: "file_id", type: "uuid", nullable: true })
  fileId: string | null;

  @ManyToOne(() => FileEntity, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "file_id" })
  file: FileEntity | null;
}
