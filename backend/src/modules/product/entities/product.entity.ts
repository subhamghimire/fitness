import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { AbstractEntity } from "src/entities";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { BillingInterval, ProductStatus, ProductType } from "../enums/product.enum";

/**
 * PRODUCT — a sellable coach offering.
 *
 * A coach lists one of four offering kinds (training programs, digital plans,
 * coaching packages, subscriptions). The row is the price list, not the
 * delivery: buying a product creates an Order → Payment → Entitlement chain,
 * and only the Entitlement grants access. See `Order`, `Payment`,
 * `Entitlement` for that flow.
 *
 * Money is stored in minor units (`priceCents`). No card data ever touches
 * this table — or any marketplace table; the payment provider owns PANs and
 * we keep only opaque provider references on `Payment`.
 */
@Entity({ name: "marketplace_products" })
@Index("idx_products_coach", ["coachId"])
@Index("idx_products_status", ["status"])
export class Product extends AbstractEntity {
  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @ManyToOne(() => Coach, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coach_id" })
  coach: Coach;

  @Column({ type: "enum", enum: ProductType })
  type: ProductType;

  @Column({ type: "enum", enum: ProductStatus, default: ProductStatus.DRAFT })
  status: ProductStatus;

  @Column({ type: "varchar", length: 200 })
  title: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  /** Price in minor units (cents). Must be > 0 — enforced by CHECK in migration. */
  @Column({ name: "price_cents", type: "int" })
  priceCents: number;

  @Column({ type: "char", length: 3, default: "USD" })
  currency: string;

  /**
   * Billing cadence. `ONE_TIME` for one-off offerings; `MONTHLY`/`YEARLY` for
   * subscriptions (drives `Entitlement.expiresAt`). Nullable for backwards
   * compatibility — treated as `ONE_TIME` when null.
   */
  @Column({ name: "billing_interval", type: "varchar", length: 16, nullable: true })
  billingInterval: string | null;

  /**
   * Optional link to a `programs` row for `TRAINING_PROGRAM` products. The
   * program itself stays the source of truth for content; this is only the
   * shelf it is sold from.
   */
  @Column({ name: "program_id", type: "uuid", nullable: true })
  programId: string | null;

  @Column({ type: "jsonb", default: {} })
  metadata: Record<string, unknown>;

  isSubscription(): boolean {
    return this.type === ProductType.SUBSCRIPTION || this.billingInterval === BillingInterval.MONTHLY || this.billingInterval === BillingInterval.YEARLY;
  }
}
