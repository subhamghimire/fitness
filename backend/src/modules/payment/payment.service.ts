import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Order } from "src/modules/order/entities/order.entity";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { OrderService } from "src/modules/order/order.service";
import { EntitlementService } from "src/modules/entitlement/entitlement.service";
import { PayoutService } from "src/modules/payout/payout.service";
import { MarketplaceAuditService } from "src/modules/marketplace/audit/marketplace-audit.service";
import { MarketplaceAuditAction } from "src/modules/marketplace/audit/marketplace-audit.action";
import { Payment } from "./entities/payment.entity";
import { ProcessedWebhookEvent } from "./entities/processed-webhook-event.entity";
import { PaymentStatus, ProviderWebhookType, canTransitionPayment } from "./enums/payment-status.enum";
import { PAYMENT_PROVIDER_TOKEN, PaymentProvider } from "./providers/payment-provider.interface";
import { CheckoutDto, CheckoutResponseDto, PaymentResponseDto, WebhookResultDto } from "./dto/payment.dto";

const UNIQUE_VIOLATION = "23505";
export const DEFAULT_WEBHOOK_SECRET = "dev-webhook-secret-change-me";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * PAYMENT SERVICE — provider orchestration for the marketplace.
 *
 * The core flow lives here: checkout creates a provider intent + a local
 * Payment row; the provider's webhook is the ONLY thing that moves money
 * state; money-state changes fan out to Order → Entitlement → Payout in that
 * order. Every fan-out step is idempotent, so a repeated, delayed, or
 * out-of-order webhook converges instead of duplicating.
 *
 * Trust boundaries:
 *  - HTTP callers authenticate with JWT; the webhook route has no JWT and
 *    authenticates with the provider's HMAC signature instead.
 *  - No card data is accepted, stored, or logged anywhere in this module.
 */
@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(ProcessedWebhookEvent) private readonly webhookEvents: Repository<ProcessedWebhookEvent>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly provider: PaymentProvider,
    private readonly orders: OrderService,
    private readonly entitlements: EntitlementService,
    private readonly payouts: PayoutService,
    private readonly audit: MarketplaceAuditService,
    private readonly config: ConfigService
  ) {}

  private webhookSecret(): string {
    return this.config.get<string>("PAYMENT_WEBHOOK_SECRET", DEFAULT_WEBHOOK_SECRET);
  }

  // ─── Checkout ─────────────────────────────────────────────────────────────

  async checkout(buyer: User, dto: CheckoutDto): Promise<CheckoutResponseDto> {
    const order = await this.orders.findOrThrow(dto.orderId);
    if (order.buyerId !== buyer.id) throw new ForbiddenException("You do not own this order");
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.REFUNDED) throw new ConflictException(`Order is already ${order.status}`);
    if (order.status === OrderStatus.CANCELLED) throw new ConflictException("Order was cancelled");

    const idempotencyKey = dto.idempotencyKey ?? `order:${order.id}:${randomUUID()}`;
    const replay = await this.payments.findOne({ where: { idempotencyKey, isDeleted: false } });
    if (replay) {
      // A key is single-use per order: replaying it for a DIFFERENT order is a
      // client bug, not an idempotent retry — fail loudly instead of returning
      // another order's payment.
      if (replay.orderId !== order.id) throw new ConflictException("Idempotency key was already used for a different order");
      return this.toCheckoutDto(replay, "");
    }

    const intent = await this.provider.createPaymentIntent({
      orderId: order.id,
      amountCents: order.amountCents,
      currency: order.currency,
      buyerId: buyer.id,
      idempotencyKey
    });

    try {
      const payment = this.payments.create({
        orderId: order.id,
        provider: this.provider.name,
        providerPaymentId: intent.providerPaymentId,
        amountCents: order.amountCents,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        idempotencyKey,
        failureCode: null,
        failureMessage: null,
        paymentMethodRef: null,
        refundedAmountCents: 0,
        providerMetadata: { providerStatus: intent.providerStatus },
        succeededAt: null
      });
      const saved = await this.payments.save(payment);
      await this.orders.markAwaitingPayment(order.id, intent.providerPaymentId);
      await this.audit.record(MarketplaceAuditAction.PAYMENT_CREATED, {
        actorId: buyer.id,
        entityType: "payment",
        entityId: saved.id,
        metadata: { orderId: order.id, provider: this.provider.name, providerPaymentId: intent.providerPaymentId, idempotencyKey }
      });
      return this.toCheckoutDto(saved, intent.clientSecret);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.payments.findOne({ where: { idempotencyKey, isDeleted: false } });
        if (winner) {
          if (winner.orderId !== order.id) throw new ConflictException("Idempotency key was already used for a different order");
          return this.toCheckoutDto(winner, "");
        }
      }
      throw err;
    }
  }

  async getForActor(user: User, id: string): Promise<PaymentResponseDto> {
    const payment = await this.payments.findOne({ where: { id, isDeleted: false }, relations: { order: true } });
    if (!payment) throw new NotFoundException("Payment not found");
    await this.assertParty(user, payment.order);
    return this.toDto(payment);
  }

  /** Buyer lists payments for their own orders (newest first). */
  async listMine(buyer: User): Promise<PaymentResponseDto[]> {
    const rows = await this.payments.find({ where: { order: { buyerId: buyer.id }, isDeleted: false }, relations: { order: true }, order: { createdAt: "DESC" } });
    return rows.map((p) => this.toDto(p));
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  /**
   * Authenticate → parse → dedupe → apply. Always answers 200 for genuine
   * provider deliveries (even replays and stale events) so the provider stops
   * retrying; 401 only for bad signatures, 400 for malformed bodies, 404 for
   * unknown providers.
   *
   * A ConflictException from the apply pipeline (e.g. funds arriving for a
   * CANCELLED order, or a refund for a payment that never succeeded) is also
   * a 200 with an audit row — not a 500. Retrying cannot move a terminal
   * state, so a 500 would only buy an infinite provider retry loop; the audit
   * row is what routes the anomaly to a human instead.
   */
  async handleWebhook(providerName: string, rawBody: string | Buffer, signature: string | undefined): Promise<WebhookResultDto> {
    if (providerName !== this.provider.name) throw new NotFoundException(`Unknown payment provider: ${providerName}`);
    this.provider.verifyWebhookSignature(rawBody, signature, this.webhookSecret());
    const event = this.provider.parseWebhookEvent(rawBody);

    await this.audit.record(MarketplaceAuditAction.WEBHOOK_RECEIVED, {
      entityType: "webhook",
      entityId: event.eventId,
      metadata: { provider: providerName, type: event.type, providerPaymentId: event.providerPaymentId }
    });

    // Idempotency ledger: first delivery inserts, replays collide.
    try {
      await this.webhookEvents.save(this.webhookEvents.create({ provider: providerName, eventId: event.eventId, eventType: event.type }));
    } catch (err) {
      if (isUniqueViolation(err)) {
        await this.audit.record(MarketplaceAuditAction.WEBHOOK_DEDUPLICATED, { entityType: "webhook", entityId: event.eventId });
        return { ok: true, deduped: true, reason: "duplicate-delivery" };
      }
      throw err;
    }

    try {
      switch (event.type) {
        case ProviderWebhookType.PAYMENT_SUCCEEDED:
          await this.applySucceeded(event.providerPaymentId, event.orderId, event.amountCents, null);
          return { ok: true, deduped: false };
        case ProviderWebhookType.PAYMENT_FAILED:
          await this.applyFailed(event.providerPaymentId, event.orderId, event.failureCode, event.failureMessage ?? "Payment failed");
          return { ok: true, deduped: false };
        case ProviderWebhookType.PAYMENT_REFUNDED:
          await this.applyRefundedByProviderRef(event.providerPaymentId, event.orderId, event.amountCents, null);
          return { ok: true, deduped: false };
        default:
          return { ok: true, deduped: true, reason: "unknown-event-type" };
      }
    } catch (err) {
      if (err instanceof ConflictException) {
        await this.audit.record(MarketplaceAuditAction.WEBHOOK_STALE_IGNORED, {
          entityType: "webhook",
          entityId: event.eventId,
          metadata: { reason: "terminal-state-conflict", detail: err.message, providerPaymentId: event.providerPaymentId }
        });
        return { ok: true, deduped: true, reason: "terminal-state-conflict" };
      }
      throw err;
    }
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────

  /**
   * Full refund of a SUCCEEDED payment (or the remainder of a PARTIALLY_
   * REFUNDED one). The buyer (own order), the selling coach, or an admin may
   * initiate it. Provider is charged first; local state fans out through the
   * same `applyRefunded` path webhooks use, so a later `payment.refunded`
   * redelivery is a deduped no-op.
   */
  async refund(actor: User, paymentId: string): Promise<PaymentResponseDto> {
    const payment = await this.payments.findOne({ where: { id: paymentId, isDeleted: false }, relations: { order: true } });
    if (!payment) throw new NotFoundException("Payment not found");
    await this.assertRefundAllowed(actor, payment.order);
    if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new ConflictException(`Only succeeded payments can be refunded (current: ${payment.status})`);
    }

    const remaining = payment.amountCents - payment.refundedAmountCents;
    if (remaining <= 0) throw new ConflictException("Payment is already fully refunded");
    const idempotencyKey = `refund:${payment.id}:${payment.refundedAmountCents}`;
    const { providerRefundId } = await this.provider.refund({ providerPaymentId: payment.providerPaymentId, amountCents: remaining, idempotencyKey });
    await this.applyRefunded(payment, payment.order, actor.id, providerRefundId, remaining);
    const reloaded = await this.payments.findOne({ where: { id: payment.id } });
    return this.toDto(reloaded!);
  }

  // ─── Apply pipeline (shared by webhooks + manual refund) ──────────────────

  private async applySucceeded(providerPaymentId: string, orderId: string | null, eventAmountCents: number | null, actorId: string | null): Promise<void> {
    const { payment, order } = await this.resolvePayment(providerPaymentId, orderId, "succeeded");
    if (!payment || !order) return;

    if (payment.status === PaymentStatus.SUCCEEDED) return; // duplicate delivery
    if (
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.CANCELED
    ) {
      await this.audit.record(MarketplaceAuditAction.WEBHOOK_STALE_IGNORED, {
        entityType: "payment",
        entityId: payment.id,
        metadata: { ignoredTransition: `${payment.status} -> succeeded`, providerPaymentId }
      });
      return;
    }
    this.assertPaymentTransition(payment.status, PaymentStatus.SUCCEEDED);
    payment.status = PaymentStatus.SUCCEEDED;
    payment.failureCode = null;
    payment.failureMessage = null;
    payment.succeededAt = new Date();
    await this.payments.save(payment);
    await this.audit.record(MarketplaceAuditAction.PAYMENT_SUCCEEDED, {
      actorId,
      entityType: "payment",
      entityId: payment.id,
      metadata: {
        orderId: order.id,
        ...(eventAmountCents !== null && eventAmountCents !== order.amountCents ? { amountMismatchCents: eventAmountCents, expectedCents: order.amountCents } : {})
      }
    });

    // Money confirmed → the core flow: Order → Entitlement → Payout.
    // May throw Conflict for terminal orders (e.g. paid-after-cancel); the
    // webhook entry point converts that into an audited 200, never a retry loop.
    const paidOrder = await this.orders.markPaid(order.id, providerPaymentId);
    await this.entitlements.grantForPaidOrder(paidOrder);
    await this.payouts.createForPaidOrder(paidOrder);
  }

  private async applyFailed(providerPaymentId: string, orderId: string | null, code: string | null, message: string): Promise<void> {
    const { payment, order } = await this.resolvePayment(providerPaymentId, orderId, "failed");
    if (!order) return;
    if (!payment) {
      // The provider failed an intent we never persisted (abandoned checkout,
      // or the local row was lost). There is no money state to regress, but
      // the order must not strand in AWAITING_PAYMENT: fail it so the buyer
      // sees the outcome and can retry. Conflicts (terminal orders) propagate
      // to the webhook entry point, which audits them as 200s.
      await this.audit.record(MarketplaceAuditAction.PAYMENT_FAILED, {
        entityType: "order",
        entityId: order.id,
        metadata: { code, noLocalPayment: true, providerPaymentId }
      });
      await this.orders.markFailed(order.id, message);
      return;
    }

    if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.PARTIALLY_REFUNDED || payment.status === PaymentStatus.REFUNDED) {
      // Delayed failure after success: must never regress money state.
      await this.audit.record(MarketplaceAuditAction.WEBHOOK_STALE_IGNORED, {
        entityType: "payment",
        entityId: payment.id,
        metadata: { ignoredTransition: `${payment.status} -> failed`, providerPaymentId }
      });
      return;
    }
    if (payment.status === PaymentStatus.FAILED) return; // duplicate
    this.assertPaymentTransition(payment.status, PaymentStatus.FAILED);
    payment.status = PaymentStatus.FAILED;
    payment.failureCode = code;
    payment.failureMessage = message;
    await this.payments.save(payment);
    await this.audit.record(MarketplaceAuditAction.PAYMENT_FAILED, { entityType: "payment", entityId: payment.id, metadata: { orderId: order.id, code } });
    await this.orders.markFailed(order.id, message);
  }

  private async applyRefundedByProviderRef(providerPaymentId: string, orderId: string | null, refundedAmountCents: number | null, actorId: string | null): Promise<void> {
    const { payment, order } = await this.resolvePayment(providerPaymentId, orderId, "refunded");
    if (!payment || !order) return;
    await this.applyRefunded(payment, order, actorId, null, refundedAmountCents);
  }

  /**
   * Refund fan-out. Partial refunds (cumulative refunded < captured) only move
   * money state on the payment row — the order stays PAID, access stays
   * granted, the payout stays pending. Only a FULL refund unwinds the chain
   * (order REFUNDED → entitlement REVOKED → payout cancelled), because only
   * then has the buyer actually lost everything they paid for.
   */
  private async applyRefunded(payment: Payment, order: Order, actorId: string | null, providerRefundId: string | null, refundedAmountCents: number | null): Promise<void> {
    if (payment.status === PaymentStatus.REFUNDED) {
      // Duplicate refund delivery — still ensure downstream convergence.
      await this.orders.markRefunded(order.id).catch(() => order);
      await this.entitlements.revokeForRefund(order.id, "duplicate refund delivery").catch(() => undefined);
      return;
    }
    if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw new ConflictException(`Only succeeded payments can be refunded (current: ${payment.status})`);
    }
    const thisRefund = refundedAmountCents ?? payment.amountCents - payment.refundedAmountCents;
    if (thisRefund <= 0) throw new ConflictException("Refund amount must be positive");
    const total = payment.refundedAmountCents + thisRefund;
    if (total > payment.amountCents) throw new ConflictException(`Refund total ${total} exceeds captured amount ${payment.amountCents}`);

    payment.refundedAmountCents = total;
    payment.providerMetadata = { ...payment.providerMetadata, ...(providerRefundId ? { providerRefundId } : {}) };
    if (total < payment.amountCents) {
      payment.status = PaymentStatus.PARTIALLY_REFUNDED;
      await this.payments.save(payment);
      await this.audit.record(MarketplaceAuditAction.PAYMENT_PARTIALLY_REFUNDED, {
        actorId,
        entityType: "payment",
        entityId: payment.id,
        metadata: { orderId: order.id, refundedAmountCents: total, amountCents: payment.amountCents, providerRefundId }
      });
      return;
    }

    payment.status = PaymentStatus.REFUNDED;
    await this.payments.save(payment);
    await this.audit.record(MarketplaceAuditAction.PAYMENT_REFUNDED, { actorId, entityType: "payment", entityId: payment.id, metadata: { orderId: order.id, providerRefundId } });

    await this.orders.markRefunded(order.id);
    await this.entitlements.revokeForRefund(order.id, "payment refunded");
    await this.payouts.cancelForRefund(order.id);
  }

  /**
   * Locate the (payment, order) pair for an event. Handles the delayed-webhook
   * case where the event names an order but no payment row exists yet (e.g.
   * the intent was created provider-side before our checkout persisted): the
   * webhook is the source of truth for provider state, so a SUCCEEDED event
   * reconciles a payment row rather than being dropped.
   */
  private async resolvePayment(providerPaymentId: string, orderId: string | null, kind: string): Promise<{ payment: Payment | null; order: Order | null }> {
    const payment = await this.payments.findOne({ where: { provider: this.provider.name, providerPaymentId, isDeleted: false }, relations: { order: true } });
    if (payment) return { payment, order: payment.order };
    if (!orderId) {
      await this.audit.record(MarketplaceAuditAction.WEBHOOK_REJECTED, {
        entityType: "webhook",
        metadata: { reason: `unknown ${kind} event: no payment for ${providerPaymentId} and no order reference` }
      });
      return { payment: null, order: null };
    }
    const order = await this.orders.findOrThrow(orderId).catch(() => null);
    if (!order) {
      await this.audit.record(MarketplaceAuditAction.WEBHOOK_REJECTED, { entityType: "webhook", metadata: { reason: `unknown order ${orderId}` } });
      return { payment: null, order: null };
    }
    if (kind !== "succeeded") return { payment: null, order };
    const reconciled = await this.payments.save(
      this.payments.create({
        orderId: order.id,
        provider: this.provider.name,
        providerPaymentId,
        amountCents: order.amountCents,
        currency: order.currency,
        status: PaymentStatus.PENDING,
        idempotencyKey: `webhook-reconciled:${providerPaymentId}`,
        failureCode: null,
        failureMessage: null,
        paymentMethodRef: null,
        refundedAmountCents: 0,
        providerMetadata: { reconciledFromWebhook: true },
        succeededAt: null
      })
    );
    const reloaded = await this.payments.findOne({ where: { id: reconciled.id }, relations: { order: true } });
    return { payment: reloaded!, order: reloaded!.order };
  }

  private async assertParty(user: User, order: Order): Promise<void> {
    if (order.buyerId === user.id || user.role === UserRole.ADMIN) return;
    const coach = await this.coaches.findOne({ where: { userId: user.id } });
    if (coach && coach.id === order.coachId) return;
    throw new ForbiddenException("You cannot access this payment");
  }

  private async assertRefundAllowed(actor: User, order: Order): Promise<void> {
    if (actor.role === UserRole.ADMIN || order.buyerId === actor.id) return;
    const coach = await this.coaches.findOne({ where: { userId: actor.id } });
    if (coach && coach.id === order.coachId) return;
    throw new ForbiddenException("You cannot refund this payment");
  }

  private assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
    if (!canTransitionPayment(from, to)) throw new ConflictException(`Payment cannot transition from ${from} to ${to}`);
  }

  private toCheckoutDto(p: Payment, clientSecret: string): CheckoutResponseDto {
    return {
      paymentId: p.id,
      orderId: p.orderId,
      provider: p.provider,
      providerPaymentId: p.providerPaymentId,
      clientSecret,
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status
    };
  }

  toDto(p: Payment): PaymentResponseDto {
    return {
      id: p.id,
      orderId: p.orderId,
      provider: p.provider,
      providerPaymentId: p.providerPaymentId,
      amountCents: p.amountCents,
      currency: p.currency,
      status: p.status,
      failureCode: p.failureCode,
      failureMessage: p.failureMessage,
      refundedAmountCents: p.refundedAmountCents,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    };
  }
}
