import { Column, Entity, Index, Unique } from "typeorm";
import { AbstractEntity } from "src/entities";
import { EntitlementStatus } from "../enums/entitlement-status.enum";

/**
 * ENTITLEMENT — proof that a buyer may access a product.
 *
 * The one hard rule of the marketplace: a row is created ONLY from a PAID
 * order (`grantForPaidOrder` rejects anything else), and a refund flips it
 * to REVOKED. One row per order (`uk_entitlements_order`), so a replayed
 * webhook converges on the existing row instead of granting twice.
 * Subscriptions carry `expiresAt`; one-off purchases live forever (null).
 */
@Entity({ name: "marketplace_entitlements" })
@Unique("uk_entitlements_order", ["orderId"])
@Index("idx_entitlements_buyer", ["buyerId"])
@Index("idx_entitlements_buyer_product", ["buyerId", "productId"])
export class Entitlement extends AbstractEntity {
  @Column({ name: "buyer_id", type: "uuid" })
  buyerId: string;

  @Column({ name: "coach_id", type: "uuid" })
  coachId: string;

  @Column({ name: "product_id", type: "uuid" })
  productId: string;

  @Column({ name: "order_id", type: "uuid" })
  orderId: string;

  @Column({ type: "enum", enum: EntitlementStatus, default: EntitlementStatus.ACTIVE })
  status: EntitlementStatus;

  @Column({ name: "activated_at", type: "timestamptz", default: () => "NOW()" })
  activatedAt: Date;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt: Date | null;

  @Column({ name: "revoke_reason", type: "varchar", length: 200, nullable: true })
  revokeReason: string | null;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt: Date | null;
}
