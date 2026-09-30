import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Order } from "src/modules/order/entities/order.entity";
import { PayoutStatus } from "../enums/payout-status.enum";

/**
 * PAYOUT — the coach's earnings for one paid order.
 *
 * Amounts are COPIED from the order snapshot (never recomputed), so the fee
 * math is frozen at purchase time: `amountCents` (gross) − `feeCents`
 * (platform) = `netCents` (coach). One payout per order
 * (`uk_payouts_order`); `payoutReference` is the idempotency key shared with
 * the external payout rail.
 */
@Entity({ name: "marketplace_payouts" })
@Unique("uk_payouts_order", ["orderId"])
@Unique("uk_payouts_reference", ["payoutReference"])
@Index("idx_payouts_coach", ["coachId"])
@Index("idx_payouts_status", ["status"])
export class Payout extends AbstractEntity {
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ name: "order_id", type: "uuid" })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "order_id" })
  order: Order;

  @Column({ name: "amount_cents", type: "int" })
  amountCents: number;

  @Column({ name: "fee_cents", type: "int" })
  feeCents: number;

  @Column({ name: "net_cents", type: "int" })
  netCents: number;

  @Column({ type: "char", length: 3, default: "USD" })
  currency: string;

  @Column({ type: "enum", enum: PayoutStatus, default: PayoutStatus.PENDING })
  status: PayoutStatus;

  @Column({ name: "payout_reference", type: "varchar", length: 120 })
  payoutReference: string;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt: Date | null;
}
