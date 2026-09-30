import { ConflictException, ForbiddenException } from "@nestjs/common";
import { OrderService } from "./order.service";
import { Order } from "./entities/order.entity";
import { OrderStatus, ORDER_TRANSITIONS, canTransitionOrder } from "./enums/order-status.enum";
import { UserRole } from "src/modules/users/enums";

/**
 * ORDER STATE MACHINE
 *
 * The table is the guarantee: a delayed `payment.failed` can never move a
 * PAID order backwards, and a refunded order is terminal. The service tests
 * below defend the webhook-relevant edges (stale-event no-ops, idempotent
 * re-application) plus buyer/coach/admin visibility.
 */

const BUYER = { id: "buyer-1", role: UserRole.USER } as never;
const COACH_USER = { id: "coach-user-1", role: UserRole.USER } as never;
const STRANGER = { id: "stranger-1", role: UserRole.USER } as never;
const ADMIN = { id: "admin-1", role: UserRole.ADMIN } as never;

const baseOrder = (over: Partial<Order> = {}): Order =>
  ({
    id: "order-1",
    buyerId: "buyer-1",
    coachId: "coach-1",
    productId: "prod-1",
    amountCents: 10000,
    currency: "USD",
    feeCents: 1000,
    netCents: 9000,
    status: OrderStatus.PENDING,
    idempotencyKey: "key-1",
    providerPaymentId: null,
    failureReason: null,
    paidAt: null,
    refundedAt: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  }) as Order;

const makeService = (order: Order) => {
  const orders = {
    findOne: jest.fn(({ where }: { where: Partial<Order> }): Promise<Order | null> => Promise.resolve(where.id === order.id ? order : null)),
    create: jest.fn((d: Partial<Order>): Order => ({ ...d }) as unknown as Order),
    save: jest.fn((o: Order): Promise<Order> => Promise.resolve(o))
  };
  const products = { findOne: jest.fn((): Promise<unknown> => Promise.resolve(null)) };
  const coaches = {
    findOne: jest.fn(
      ({ where }: { where: { userId?: string } }): Promise<unknown> => Promise.resolve(where.userId === "coach-user-1" ? { id: "coach-1", userId: "coach-user-1" } : null)
    )
  };
  const audit = { record: jest.fn((): Promise<void> => Promise.resolve()) };
  const config = { get: jest.fn((_k: string, dflt: unknown): unknown => dflt) };
  const service = new OrderService(orders as never, products as never, coaches as never, audit as never, config as never);
  return { service, orders, products, coaches };
};

describe("ORDER_TRANSITIONS table", () => {
  it("allows the happy path PENDING → AWAITING_PAYMENT → PAID → REFUNDED", () => {
    expect(canTransitionOrder(OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT)).toBe(true);
    expect(canTransitionOrder(OrderStatus.AWAITING_PAYMENT, OrderStatus.PAID)).toBe(true);
    expect(canTransitionOrder(OrderStatus.PAID, OrderStatus.REFUNDED)).toBe(true);
  });

  it("allows retry from FAILED", () => {
    expect(canTransitionOrder(OrderStatus.FAILED, OrderStatus.AWAITING_PAYMENT)).toBe(true);
    expect(canTransitionOrder(OrderStatus.FAILED, OrderStatus.PAID)).toBe(true);
  });

  it("never moves backwards from a terminal/paid state (delayed-webhook safety)", () => {
    expect(canTransitionOrder(OrderStatus.PAID, OrderStatus.FAILED)).toBe(false);
    expect(canTransitionOrder(OrderStatus.PAID, OrderStatus.PENDING)).toBe(false);
    expect(canTransitionOrder(OrderStatus.REFUNDED, OrderStatus.PAID)).toBe(false);
    expect(canTransitionOrder(OrderStatus.CANCELLED, OrderStatus.PAID)).toBe(false);
  });

  it("every declared transition target is a known status (table integrity)", () => {
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
      expect(Object.values(OrderStatus)).toContain(from);
      for (const to of tos) expect(Object.values(OrderStatus)).toContain(to);
    }
  });
});

describe("OrderService webhook edges", () => {
  it("markPaid is idempotent: re-applying PAID returns the row", async () => {
    const order = baseOrder({ status: OrderStatus.PAID });
    const { service, orders } = makeService(order);
    const result = await service.markPaid(order.id, "mock_pi_1");
    expect(result.status).toBe(OrderStatus.PAID);
    expect(orders.save).toHaveBeenCalled();
  });

  it("markFailed on a PAID order is a no-op (delayed failure must not regress)", async () => {
    const order = baseOrder({ status: OrderStatus.PAID });
    const { service } = makeService(order);
    const result = await service.markFailed(order.id, "card_declined");
    expect(result.status).toBe(OrderStatus.PAID);
  });

  it("markFailed on a REFUNDED order is a no-op", async () => {
    const order = baseOrder({ status: OrderStatus.REFUNDED });
    const { service } = makeService(order);
    const result = await service.markFailed(order.id, "card_declined");
    expect(result.status).toBe(OrderStatus.REFUNDED);
  });

  it("markRefunded rejects a non-PAID order", async () => {
    const order = baseOrder({ status: OrderStatus.AWAITING_PAYMENT });
    const { service } = makeService(order);
    await expect(service.markRefunded(order.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it("cancel rejects a PAID order", async () => {
    const order = baseOrder({ status: OrderStatus.PAID });
    const { service } = makeService(order);
    await expect(service.cancel(BUYER, order.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it("markAwaitingPayment refreshes the intent on retry instead of 409ing", async () => {
    const order = baseOrder({ status: OrderStatus.AWAITING_PAYMENT, providerPaymentId: "mock_pi_old" });
    const { service } = makeService(order);
    const result = await service.markAwaitingPayment(order.id, "mock_pi_new");
    expect(result.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(result.providerPaymentId).toBe("mock_pi_new");
  });
});

describe("OrderService idempotency scoping", () => {
  it("rejects an idempotency key already used for a different product", async () => {
    const existing = baseOrder({ productId: "prod-1" });
    const otherProduct = { id: "prod-2", coachId: "coach-1", status: "active", priceCents: 5000, currency: "USD" };
    const { service, orders, products, coaches } = makeService(existing);
    orders.findOne.mockImplementation(
      ({ where }: { where: Partial<Order> }): Promise<Order | null> =>
        Promise.resolve(where.buyerId === existing.buyerId && where.idempotencyKey === existing.idempotencyKey ? existing : null)
    );
    products.findOne.mockImplementation((): Promise<unknown> => Promise.resolve(otherProduct));
    coaches.findOne.mockImplementation((): Promise<unknown> => Promise.resolve({ id: "coach-1" }));

    await expect(service.create(BUYER, { productId: "prod-2", idempotencyKey: "key-1" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("returns the existing order when the key and product match", async () => {
    const existing = baseOrder({ productId: "prod-1" });
    const product = { id: "prod-1", coachId: "coach-1", status: "active", priceCents: 10000, currency: "USD" };
    const { service, orders, products, coaches } = makeService(existing);
    orders.findOne.mockImplementation((): Promise<Order | null> => Promise.resolve(existing));
    products.findOne.mockImplementation((): Promise<unknown> => Promise.resolve(product));
    coaches.findOne.mockImplementation((): Promise<unknown> => Promise.resolve({ id: "coach-1" }));

    const result = await service.create(BUYER, { productId: "prod-1", idempotencyKey: "key-1" });
    expect(result).toMatchObject({ id: existing.id, productId: "prod-1" });
  });
});

describe("OrderService visibility (unauthorized access)", () => {
  it("lets the buyer, the selling coach, and admins read; forbids strangers", async () => {
    const order = baseOrder();
    const { service } = makeService(order);
    await expect(service.getForActor(BUYER, order.id)).resolves.toMatchObject({ id: order.id });
    await expect(service.getForActor(COACH_USER, order.id)).resolves.toMatchObject({ id: order.id });
    await expect(service.getForActor(ADMIN, order.id)).resolves.toMatchObject({ id: order.id });
    await expect(service.getForActor(STRANGER, order.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
