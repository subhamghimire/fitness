import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { Order } from "src/modules/order/entities/order.entity";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { Product } from "src/modules/product/entities/product.entity";
import { BillingInterval } from "src/modules/product/enums/product.enum";
import { MarketplaceAuditService } from "src/modules/marketplace/audit/marketplace-audit.service";
import { MarketplaceAuditAction } from "src/modules/marketplace/audit/marketplace-audit.action";
import { Entitlement } from "./entities/entitlement.entity";
import { EntitlementStatus } from "./enums/entitlement-status.enum";
import { AccessCheckResponseDto, EntitlementResponseDto } from "./dto/entitlement.dto";

/**
 * ENTITLEMENT SERVICE — access grants derived strictly from paid orders.
 *
 * `grantForPaidOrder` is the ONLY creation path and it refuses non-PAID
 * orders outright: there is no code path that grants access on intent,
 * on webhook receipt, or on optimism. Re-granting for the same order returns
 * the existing row (webhook replays converge). `revokeForRefund` is the
 * mirror: REFUNDED money always removes access.
 */
@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(Entitlement) private readonly entitlements: Repository<Entitlement>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly audit: MarketplaceAuditService
  ) {}

  async grantForPaidOrder(order: Order): Promise<Entitlement> {
    if (order.status !== OrderStatus.PAID) {
      throw new ForbiddenException("Entitlement can only be granted for a paid order");
    }
    const existing = await this.entitlements.findOne({ where: { orderId: order.id, isDeleted: false } });
    if (existing) return existing;

    const product = await this.products.findOne({ where: { id: order.productId } });
    const entitlement = this.entitlements.create({
      buyerId: order.buyerId,
      coachId: order.coachId,
      productId: order.productId,
      orderId: order.id,
      status: EntitlementStatus.ACTIVE,
      activatedAt: new Date(),
      revokedAt: null,
      revokeReason: null,
      expiresAt: this.expiryFor(product?.billingInterval ?? null)
    });
    try {
      const saved = await this.entitlements.save(entitlement);
      await this.audit.record(MarketplaceAuditAction.ENTITLEMENT_GRANTED, {
        entityType: "entitlement",
        entityId: saved.id,
        metadata: { orderId: order.id, buyerId: order.buyerId, productId: order.productId }
      });
      return saved;
    } catch (err) {
      // A racing webhook won — return the winner's row.
      if ((err as { code?: string }).code === "23505") {
        const winner = await this.entitlements.findOne({ where: { orderId: order.id, isDeleted: false } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  async revokeForRefund(orderId: string, reason: string): Promise<Entitlement | null> {
    const entitlement = await this.entitlements.findOne({ where: { orderId, isDeleted: false } });
    if (!entitlement) return null;
    if (entitlement.status === EntitlementStatus.REVOKED) return entitlement;
    entitlement.status = EntitlementStatus.REVOKED;
    entitlement.revokedAt = new Date();
    entitlement.revokeReason = reason;
    const saved = await this.entitlements.save(entitlement);
    await this.audit.record(MarketplaceAuditAction.ENTITLEMENT_REVOKED, {
      entityType: "entitlement",
      entityId: saved.id,
      metadata: { orderId, reason }
    });
    return saved;
  }

  /** Read-path access check used by the entitlement guard and clients. */
  async hasAccess(buyerId: string, productId: string): Promise<AccessCheckResponseDto> {
    const entitlement = await this.entitlements.findOne({
      where: { buyerId, productId, status: EntitlementStatus.ACTIVE, isDeleted: false },
      order: { activatedAt: "DESC" }
    });
    if (!entitlement) return { hasAccess: false };
    if (entitlement.expiresAt && entitlement.expiresAt <= new Date()) {
      await this.markExpired(entitlement);
      return { hasAccess: false };
    }
    return { hasAccess: true, entitlementId: entitlement.id, expiresAt: entitlement.expiresAt };
  }

  /**
   * Sweep lapsed subscriptions to EXPIRED. Reads already expire lazily (see
   * `hasAccess`), so this is strictly a hygiene pass for list views and
   * reporting — wire it to a scheduler (cron/queue tick); it is idempotent
   * and safe to run as often as useful.
   */
  async expireDue(now: Date = new Date()): Promise<number> {
    const due = await this.entitlements.find({ where: { status: EntitlementStatus.ACTIVE, expiresAt: LessThan(now), isDeleted: false } });
    for (const entitlement of due) {
      entitlement.status = EntitlementStatus.EXPIRED;
      await this.entitlements.save(entitlement);
    }
    return due.length;
  }

  async listMine(buyer: User): Promise<EntitlementResponseDto[]> {
    const rows = await this.entitlements.find({ where: { buyerId: buyer.id, isDeleted: false }, order: { activatedAt: "DESC" } });
    return rows.map((r) => this.toDto(r));
  }

  async getForActor(user: User, id: string): Promise<EntitlementResponseDto> {
    const entitlement = await this.entitlements.findOne({ where: { id, isDeleted: false } });
    if (!entitlement) throw new NotFoundException("Entitlement not found");
    if (entitlement.buyerId !== user.id && user.role !== UserRole.ADMIN) throw new ForbiddenException("You cannot access this entitlement");
    return this.toDto(entitlement);
  }

  private async markExpired(entitlement: Entitlement): Promise<void> {
    entitlement.status = EntitlementStatus.EXPIRED;
    await this.entitlements.save(entitlement);
  }

  private expiryFor(billingInterval: string | null): Date | null {
    const now = Date.now();
    if (billingInterval === BillingInterval.MONTHLY) return new Date(now + 30 * 24 * 3600 * 1000);
    if (billingInterval === BillingInterval.YEARLY) return new Date(now + 365 * 24 * 3600 * 1000);
    return null;
  }

  toDto(e: Entitlement): EntitlementResponseDto {
    return {
      id: e.id,
      buyerId: e.buyerId,
      coachId: e.coachId,
      productId: e.productId,
      orderId: e.orderId,
      status: e.status,
      activatedAt: e.activatedAt,
      revokedAt: e.revokedAt,
      expiresAt: e.expiresAt
    };
  }
}
