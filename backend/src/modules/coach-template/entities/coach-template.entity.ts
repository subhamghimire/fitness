import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Entity, Index, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from "typeorm";
import { CoachTemplateType, DiscountType } from "../enums/coach-template.enum";

@Entity({ name: "coach_templates" })
export class CoachTemplate extends AbstractEntity {
  @Column({ length: 150 })
  title: string;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  price: number;

  @Column({ type: "numeric", precision: 10, scale: 2, nullable: true })
  discount: number;

  @Column({ type: "enum", enum: DiscountType, nullable: true })
  discountType: DiscountType;

  @Column({ type: "enum", enum: CoachTemplateType })
  type: CoachTemplateType;

  @Index()
  @Column({ type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coachId" })
  coach: Coach;
}
