import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Product } from "src/modules/product/entities/product.entity";
import { OrderStatus } from "../enums/order-status.enum";

/**
 * ORDER — the buyer's intent to purchase one product, with a price snapshot.
 *
 * `amountCents`/`feeCents`/`netCents` are frozen at creation from the product
 * price so a later price edit can never change what an in-flight order owes,
 * and the payout for a paid order reuses this snapshot rather than
 * recomputing. `idempotencyKey` is scoped per buyer: retrying "create order"
 * with the same key returns the existing row instead of a second order.
 */
@Entity({ name: "marketplace_orders" })
@Unique("uk_orders_buyer_idempotency", ["buyerId", "idempotencyKey"])
@Index("idx_orders_buyer", ["buyerId"])
@Index("idx_orders_coach", ["coachId"])
@Index("idx_orders_status", ["status"])
export class Order extends AbstractEntity {
  @Column({ name: "buyer_id", type: "uuid" })
  buyerId: string;

  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  @ManyToOne(() => Product, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "product_id" })
  product: Product;

  @Column({ name: "amount_cents", type: "int" })
  amountCents: number;

  @Column({ type: "char", length: 3, default: "USD" })
  currency: string;

  /** Platform fee snapshot (minor units). */
  @Column({ name: "fee_cents", type: "int", default: 0 })
  feeCents: number;

  /** Coach earnings snapshot: amountCents - feeCents. */
  @Column({ name: "net_cents", type: "int", default: 0 })
  netCents: number;

  @Column({ type: "enum", enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ name: "idempotency_key", type: "varchar", length: 120 })
  idempotencyKey: string;

  /** Latest provider intent reference (informational; Payment rows are authoritative). */
  @Column({ name: "provider_payment_id", type: "varchar", length: 120, nullable: true })
  providerPaymentId: string | null;

  @Column({ name: "failure_reason", type: "text", nullable: true })
  failureReason: string | null;

  @Column({ name: "paid_at", type: "timestamptz", nullable: true })
  paidAt: Date | null;

  @Column({ name: "refunded_at", type: "timestamptz", nullable: true })
  refundedAt: Date | null;
}
