import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Order } from "src/modules/order/entities/order.entity";
import { PaymentStatus } from "../enums/payment-status.enum";

/**
 * PAYMENT — one charge attempt against an order.
 *
 * SECURITY: this row (and every marketplace row) stores NO card data — no
 * PAN, no expiry, no CVC. `paymentMethodRef` holds only an opaque provider
 * token (e.g. `pm_…`) when the provider supplies one, and `providerMetadata`
 * is restricted to non-sensitive provider fields (intent ids, receipt urls).
 * Raw provider payloads containing card details must never be persisted;
 * providers are expected to redact them before we see them, and the mock
 * provider below never generates them.
 */
@Entity({ name: "marketplace_payments" })
@Unique("uk_payments_provider_payment_id", ["provider", "providerPaymentId"])
@Unique("uk_payments_idempotency_key", ["idempotencyKey"])
@Index("idx_payments_order", ["orderId"])
@Index("idx_payments_status", ["status"])
export class Payment extends AbstractEntity {
  @Column({ name: "order_id", type: "uuid" })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "order_id" })
  order: Order;

  /** Provider name: "mock" | "stripe" (see PAYMENT_PROVIDER). */
  @Column({ type: "varchar", length: 40, default: "mock" })
  provider: string;

  @Column({ name: "provider_payment_id", type: "varchar", length: 120 })
  providerPaymentId: string;

  @Column({ name: "amount_cents", type: "int" })
  amountCents: number;

  @Column({ type: "char", length: 3, default: "USD" })
  currency: string;

  @Column({ type: "enum", enum: PaymentStatus, default: PaymentStatus.CREATED })
  status: PaymentStatus;

  @Column({ name: "idempotency_key", type: "varchar", length: 120 })
  idempotencyKey: string;

  @Column({ name: "failure_code", type: "varchar", length: 80, nullable: true })
  failureCode: string | null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null;

  /**
   * Opaque provider payment-method token only (e.g. `pm_123`). NEVER card
   * numbers, expiries, or CVCs — those must not be written here by any caller.
   */
  @Column({ name: "payment_method_ref", type: "varchar", length: 120, nullable: true })
  paymentMethodRef: string | null;

  @Column({ name: "refunded_amount_cents", type: "int", default: 0 })
  refundedAmountCents: number;

  /** Non-sensitive provider fields only. */
  @Column({ name: "provider_metadata", type: "jsonb", default: {} })
  providerMetadata: Record<string, unknown>;

  @Column({ name: "succeeded_at", type: "timestamptz", nullable: true })
  succeededAt: Date | null;
}
