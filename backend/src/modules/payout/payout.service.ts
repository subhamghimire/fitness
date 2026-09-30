import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Order } from "src/modules/order/entities/order.entity";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { MarketplaceAuditService } from "src/modules/marketplace/audit/marketplace-audit.service";
import { MarketplaceAuditAction } from "src/modules/marketplace/audit/marketplace-audit.action";
import { Payout } from "./entities/payout.entity";
import { PayoutStatus, canTransitionPayout } from "./enums/payout-status.enum";
import { PayoutResponseDto } from "./dto/payout.dto";

/**
 * PAYOUT SERVICE — coach earnings ledger.
 *
 * A payout is created exactly once per PAID order, copying the order's frozen
 * money snapshot. Status moves only forward (PENDING → PROCESSING → PAID)
 * under admin control. A refund cancels an unprocessed payout; if money
 * already left (PAID) the row is left intact and flagged in the audit log so
 * finance handles the clawback manually — silently rewriting a PAID payout
 * would destroy the paper trail.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @InjectRepository(Payout) private readonly payouts: Repository<Payout>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    private readonly audit: MarketplaceAuditService
  ) {}

  async createForPaidOrder(order: Order): Promise<Payout> {
    if (order.status !== OrderStatus.PAID) throw new ConflictException("Payouts can only be created for paid orders");
    const existing = await this.payouts.findOne({ where: { orderId: order.id, isDeleted: false } });
    if (existing) return existing;
    try {
      const payout = this.payouts.create({
        coachId: order.coachId,
        orderId: order.id,
        amountCents: order.amountCents,
        feeCents: order.feeCents,
        netCents: order.netCents,
        currency: order.currency,
        status: PayoutStatus.PENDING,
        payoutReference: `po_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        failureReason: null,
        processedAt: null
      });
      const saved = await this.payouts.save(payout);
      await this.audit.record(MarketplaceAuditAction.PAYOUT_CREATED, {
        entityType: "payout",
        entityId: saved.id,
        metadata: { orderId: order.id, coachId: order.coachId, netCents: saved.netCents, payoutReference: saved.payoutReference }
      });
      return saved;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        const winner = await this.payouts.findOne({ where: { orderId: order.id, isDeleted: false } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Refund path: cancel payouts that never left; leave PAID ones for manual
   * clawback. Idempotent — already-CANCELED returns as-is.
   */
  async cancelForRefund(orderId: string): Promise<Payout | null> {
    const payout = await this.payouts.findOne({ where: { orderId, isDeleted: false } });
    if (!payout) return null;
    if (payout.status === PayoutStatus.CANCELED) return payout;
    if (payout.status === PayoutStatus.PAID || payout.status === PayoutStatus.PROCESSING) {
      this.logger.warn(`Payout ${payout.id} for refunded order ${orderId} is already ${payout.status} — manual clawback required`);
      await this.audit.record(MarketplaceAuditAction.PAYOUT_CANCELLED, {
        entityType: "payout",
        entityId: payout.id,
        metadata: { orderId, skipped: true, reason: `payout already ${payout.status}; manual clawback required` }
      });
      return payout;
    }
    payout.status = PayoutStatus.CANCELED;
    const saved = await this.payouts.save(payout);
    await this.audit.record(MarketplaceAuditAction.PAYOUT_CANCELLED, { entityType: "payout", entityId: saved.id, metadata: { orderId } });
    return saved;
  }

  /** Admin moves a payout along its state machine. */
  async setStatus(admin: User, id: string, status: PayoutStatus, failureReason?: string): Promise<PayoutResponseDto> {
    if (admin.role !== UserRole.ADMIN) throw new ForbiddenException("Only admins can update payouts");
    const payout = await this.payouts.findOne({ where: { id, isDeleted: false } });
    if (!payout) throw new NotFoundException("Payout not found");
    if (payout.status !== status) {
      if (!canTransitionPayout(payout.status, status)) throw new ConflictException(`Payout cannot transition from ${payout.status} to ${status}`);
      payout.status = status;
      payout.failureReason = failureReason ?? null;
      if (status === PayoutStatus.PAID) payout.processedAt = new Date();
      await this.payouts.save(payout);
      await this.audit.record(MarketplaceAuditAction.PAYOUT_STATUS_CHANGED, {
        actorId: admin.id,
        entityType: "payout",
        entityId: payout.id,
        metadata: { status, payoutReference: payout.payoutReference }
      });
    }
    const reloaded = await this.payouts.findOne({ where: { id } });
    return this.toDto(reloaded!);
  }

  async listMine(user: User): Promise<PayoutResponseDto[]> {
    const coach = await this.coaches.findOne({ where: { userId: user.id } });
    if (!coach) {
      if (user.role === UserRole.ADMIN) {
        const all = await this.payouts.find({ where: { isDeleted: false }, order: { createdAt: "DESC" } });
        return all.map((p) => this.toDto(p));
      }
      throw new ForbiddenException("Only coaches can view payouts");
    }
    const rows = await this.payouts.find({ where: { coachId: coach.id, isDeleted: false }, order: { createdAt: "DESC" } });
    return rows.map((p) => this.toDto(p));
  }

  async getForActor(user: User, id: string): Promise<PayoutResponseDto> {
    const payout = await this.payouts.findOne({ where: { id, isDeleted: false } });
    if (!payout) throw new NotFoundException("Payout not found");
    if (user.role === UserRole.ADMIN) return this.toDto(payout);
    const coach = await this.coaches.findOne({ where: { userId: user.id } });
    if (!coach || coach.id !== payout.coachId) throw new ForbiddenException("You cannot access this payout");
    return this.toDto(payout);
  }

  toDto(p: Payout): PayoutResponseDto {
    return {
      id: p.id,
      coachId: p.coachId,
      orderId: p.orderId,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      status: p.status,
      payoutReference: p.payoutReference,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }
}
