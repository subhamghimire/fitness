import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Product } from "src/modules/product/entities/product.entity";
import { ProductStatus } from "src/modules/product/enums/product.enum";
import { MarketplaceAuditService } from "src/modules/marketplace/audit/marketplace-audit.service";
import { MarketplaceAuditAction } from "src/modules/marketplace/audit/marketplace-audit.action";
import { DEFAULT_PLATFORM_FEE_BPS, calculateMarketplaceSplit } from "src/modules/marketplace/marketplace-fees";
import { CreateOrderDto, OrderResponseDto } from "./dto/order.dto";
import { Order } from "./entities/order.entity";
import { OrderStatus, canTransitionOrder } from "./enums/order-status.enum";

/** Postgres unique-violation — a concurrent retry racing this request. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * ORDER SERVICE — the purchase state machine.
 *
 * Each mutating method is idempotent in the direction webhooks need:
 * re-applying the current state is a no-op return, moving backwards from a
 * terminal state is a no-op return (never an exception — a delayed
 * `payment.failed` arriving after `payment.succeeded` must be a 200 with no
 * state change), and only a genuinely illegal jump throws ConflictException.
 */
@Injectable()
export class OrderService {
  private readonly feeBps: number;

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    private readonly audit: MarketplaceAuditService,
    configService: ConfigService
  ) {
    const raw = configService.get<string>("MARKETPLACE_PLATFORM_FEE_BPS");
    const parsed = raw ? Number(raw) : DEFAULT_PLATFORM_FEE_BPS;
    this.feeBps = Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000 ? parsed : DEFAULT_PLATFORM_FEE_BPS;
  }

  async create(buyer: User, dto: CreateOrderDto): Promise<OrderResponseDto> {
    const product = await this.products.findOne({ where: { id: dto.productId, isDeleted: false } });
    if (!product || product.status !== ProductStatus.ACTIVE) throw new NotFoundException("Product is not available for purchase");
    if (product.coachId) {
      const coach = await this.coaches.findOne({ where: { id: product.coachId } });
      if (!coach) throw new NotFoundException("Product is not available for purchase");
    }
    const { feeCents, netCents } = calculateMarketplaceSplit(product.priceCents, this.feeBps);
    const idempotencyKey = dto.idempotencyKey ?? randomUUID();

    const existing = await this.orders.findOne({ where: { buyerId: buyer.id, idempotencyKey, isDeleted: false } });
    if (existing) {
      // Same scope rule as payments: a key is single-use per product. Replaying
      // it for a DIFFERENT product is a client bug — fail loudly instead of
      // returning another product's order.
      if (existing.productId !== product.id) throw new ConflictException("Idempotency key was already used for a different product");
      return this.toDto(existing);
    }

    try {
      const order = this.orders.create({
        buyerId: buyer.id,
        coachId: product.coachId,
        productId: product.id,
        amountCents: product.priceCents,
        currency: product.currency,
        feeCents,
        netCents,
        status: OrderStatus.PENDING,
        idempotencyKey,
        providerPaymentId: null,
        failureReason: null,
        paidAt: null,
        refundedAt: null
      });
      const saved = await this.orders.save(order);
      await this.audit.record(MarketplaceAuditAction.ORDER_CREATED, {
        actorId: buyer.id,
        entityType: "order",
        entityId: saved.id,
        metadata: { productId: product.id, coachId: product.coachId, amountCents: saved.amountCents, idempotencyKey }
      });
      return this.toDto(saved);
    } catch (err) {
      if (isUniqueViolation(err)) {
        // A concurrent retry won the race — return the winner's row.
        const winner = await this.orders.findOne({ where: { buyerId: buyer.id, idempotencyKey, isDeleted: false } });
        if (winner) return this.toDto(winner);
      }
      throw err;
    }
  }

  async getForActor(user: User, id: string): Promise<OrderResponseDto> {
    const order = await this.requireVisible(user, id);
    return this.toDto(order);
  }

  async listMine(user: User): Promise<OrderResponseDto[]> {
    const rows = await this.orders.find({ where: { buyerId: user.id, isDeleted: false }, order: { createdAt: "DESC" } });
    return rows.map((r) => this.toDto(r));
  }

  async listForCoach(user: User): Promise<OrderResponseDto[]> {
    const coach = await this.coaches.findOne({ where: { userId: user.id } });
    if (!coach && user.role !== UserRole.ADMIN) throw new ForbiddenException("Only coaches can view sales");
    const rows = await this.orders.find({
      where: user.role === UserRole.ADMIN ? { isDeleted: false } : { coachId: coach!.id, isDeleted: false },
      order: { createdAt: "DESC" }
    });
    return rows.map((r) => this.toDto(r));
  }

  async cancel(buyer: User, id: string): Promise<OrderResponseDto> {
    const order = await this.orders.findOne({ where: { id, isDeleted: false } });
    if (!order) throw new NotFoundException("Order not found");
    if (order.buyerId !== buyer.id && buyer.role !== UserRole.ADMIN) throw new ForbiddenException("You do not own this order");
    this.assertTransition(order.status, OrderStatus.CANCELLED);
    order.status = OrderStatus.CANCELLED;
    const saved = await this.orders.save(order);
    await this.audit.record(MarketplaceAuditAction.ORDER_CANCELLED, { actorId: buyer.id, entityType: "order", entityId: saved.id });
    return this.toDto(saved);
  }

  /** Webhook/orchestration path: record that funds were confirmed. Idempotent. */
  async markPaid(id: string, providerPaymentId: string): Promise<Order> {
    const order = await this.findOrThrow(id);
    if (order.status === OrderStatus.PAID) {
      order.providerPaymentId = providerPaymentId;
      return this.orders.save(order);
    }
    this.assertTransition(order.status, OrderStatus.PAID);
    order.status = OrderStatus.PAID;
    order.providerPaymentId = providerPaymentId;
    order.failureReason = null;
    order.paidAt = new Date();
    const saved = await this.orders.save(order);
    await this.audit.record(MarketplaceAuditAction.ORDER_PAID, { entityType: "order", entityId: saved.id, metadata: { providerPaymentId } });
    return saved;
  }

  /**
   * Webhook path: record a failure. A stale failure for an already-PAID (or
   * REFUNDED) order is a no-op — this is the delayed-webhook guarantee.
   */
  async markFailed(id: string, reason: string): Promise<Order> {
    const order = await this.findOrThrow(id);
    if (order.status === OrderStatus.FAILED) {
      order.failureReason = reason;
      return this.orders.save(order);
    }
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.REFUNDED) {
      await this.audit.record(MarketplaceAuditAction.WEBHOOK_STALE_IGNORED, {
        entityType: "order",
        entityId: order.id,
        metadata: { ignoredTransition: `${order.status} -> failed`, reason }
      });
      return order;
    }
    this.assertTransition(order.status, OrderStatus.FAILED);
    order.status = OrderStatus.FAILED;
    order.failureReason = reason;
    const saved = await this.orders.save(order);
    await this.audit.record(MarketplaceAuditAction.ORDER_FAILED, { entityType: "order", entityId: saved.id, metadata: { reason } });
    return saved;
  }

  /** Webhook/refund path: PAID → REFUNDED. Idempotent. */
  async markRefunded(id: string): Promise<Order> {
    const order = await this.findOrThrow(id);
    if (order.status === OrderStatus.REFUNDED) return order;
    this.assertTransition(order.status, OrderStatus.REFUNDED);
    order.status = OrderStatus.REFUNDED;
    order.refundedAt = new Date();
    const saved = await this.orders.save(order);
    await this.audit.record(MarketplaceAuditAction.ORDER_REFUNDED, { entityType: "order", entityId: saved.id });
    return saved;
  }

  /** Checkout path: PENDING/FAILED → AWAITING_PAYMENT, with intent refresh. */
  async markAwaitingPayment(id: string, providerPaymentId: string): Promise<Order> {
    const order = await this.findOrThrow(id);
    if (order.status === OrderStatus.AWAITING_PAYMENT) {
      // Legit retry (buyer re-submits checkout, new provider intent): refresh
      // the reference instead of 409ing. A retry that reaches PAID later still
      // converges through markPaid's own idempotency.
      order.providerPaymentId = providerPaymentId;
      return this.orders.save(order);
    }
    this.assertTransition(order.status, OrderStatus.AWAITING_PAYMENT);
    order.status = OrderStatus.AWAITING_PAYMENT;
    order.providerPaymentId = providerPaymentId;
    return this.orders.save(order);
  }

  async findOrThrow(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id, isDeleted: false } });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  private async requireVisible(user: User, id: string): Promise<Order> {
    const order = await this.findOrThrow(id);
    if (order.buyerId === user.id || user.role === UserRole.ADMIN) return order;
    const coach = await this.coaches.findOne({ where: { userId: user.id } });
    if (coach && coach.id === order.coachId) return order;
    throw new ForbiddenException("You cannot access this order");
  }

  private assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!canTransitionOrder(from, to)) throw new ConflictException(`Order cannot transition from ${from} to ${to}`);
  }

  toDto(o: Order): OrderResponseDto {
    return {
      id: o.id,
      buyerId: o.buyerId,
      coachId: o.coachId,
      productId: o.productId,
      amountCents: o.amountCents,
      currency: o.currency,
      feeCents: o.feeCents,
      netCents: o.netCents,
      status: o.status,
      idempotencyKey: o.idempotencyKey,
      providerPaymentId: o.providerPaymentId,
      failureReason: o.failureReason,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt
    };
  }
}
