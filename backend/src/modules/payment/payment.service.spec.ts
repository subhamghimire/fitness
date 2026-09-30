import { ConflictException, ForbiddenException, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { PaymentService } from "./payment.service";
import { Payment } from "./entities/payment.entity";
import { PaymentStatus } from "./enums/payment-status.enum";
import { Order } from "src/modules/order/entities/order.entity";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { MockPaymentProvider, buildMockWebhookEvent, signMockWebhook } from "./providers/mock-payment.provider";
import { UserRole } from "src/modules/users/enums";

/**
 * PAYMENT SERVICE — webhook & money-flow suite.
 *
 * Covers the spec's required cases against in-memory fakes (no DB):
 * successful payment, failed payment, duplicate webhook, delayed webhook
 * (failure arriving after success), refund, invalid webhook, and
 * unauthorized access. The property under test throughout: replays and
 * out-of-order deliveries converge — they never duplicate orders, payments,
 * or entitlements.
 */

const SECRET = "test-webhook-secret";
const BUYER = { id: "buyer-1", role: UserRole.USER };
const STRANGER = { id: "stranger-1", role: UserRole.USER };

const baseOrder = (): Order =>
  ({
    id: "order-1",
    buyerId: "buyer-1",
    coachId: "coach-1",
    productId: "prod-1",
    amountCents: 10000,
    currency: "USD",
    feeCents: 1000,
    netCents: 9000,
    status: OrderStatus.AWAITING_PAYMENT,
    idempotencyKey: "key-1",
    providerPaymentId: "mock_pi_1",
    failureReason: null,
    paidAt: null,
    refundedAt: null,
    isDeleted: false
  }) as unknown as Order;

interface Fixture {
  service: PaymentService;
  payments: Map<string, Payment>;
  seenEvents: Set<string>;
  order: Order;
  grantForPaidOrder: jest.Mock;
  revokeForRefund: jest.Mock;
  createPayout: jest.Mock;
  cancelPayout: jest.Mock;
  markPaid: jest.Mock;
  markFailed: jest.Mock;
  markRefunded: jest.Mock;
  markAwaitingPayment: jest.Mock;
}

const paymentMatches = (p: Payment, where: Partial<Payment>): boolean => {
  if (where.id && p.id !== where.id) return false;
  if (where.idempotencyKey && p.idempotencyKey !== where.idempotencyKey) return false;
  if (where.providerPaymentId && (p.provider !== where.provider || p.providerPaymentId !== where.providerPaymentId)) return false;
  if (where.isDeleted !== undefined && p.isDeleted !== where.isDeleted) return false;
  return true;
};

/** Unique-violation shaped like the Postgres 23505 the service handles. */
const uniqueViolation = (): Error => Object.assign(new Error("duplicate key value"), { code: "23505" });

const setup = (orderStatus: OrderStatus = OrderStatus.AWAITING_PAYMENT): Fixture => {
  const payments = new Map<string, Payment>();
  const seenEvents = new Set<string>();
  const order: Order = { ...baseOrder(), status: orderStatus } as unknown as Order;
  let seq = 0;

  const paymentsRepo = {
    findOne: jest.fn(({ where }: { where: Partial<Payment> }): Promise<Payment | null> => {
      for (const p of payments.values()) {
        if (paymentMatches(p, where)) return Promise.resolve({ ...p, order } as unknown as Payment);
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((d: Partial<Payment>): Payment => ({ id: `pay-${++seq}`, isDeleted: false, createdAt: new Date(), updatedAt: new Date(), ...d }) as unknown as Payment),
    find: jest.fn((opts: { where: { order?: { buyerId?: string }; isDeleted?: boolean } }): Promise<Payment[]> => {
      const buyerId = opts.where.order?.buyerId;
      const rows = [...payments.values()].filter(
        (p) => (buyerId ? order.buyerId === buyerId : true) && (opts.where.isDeleted === undefined || p.isDeleted === opts.where.isDeleted)
      );
      return Promise.resolve(rows.map((p) => ({ ...p, order }) as unknown as Payment));
    }),
    save: jest.fn((p: Payment): Promise<Payment> => {
      payments.set(p.id, { ...p } as unknown as Payment);
      return Promise.resolve({ ...p, order } as unknown as Payment);
    })
  };
  const webhookEventsRepo = {
    create: jest.fn((d: Partial<{ provider: string; eventId: string; eventType: string }>) => d),
    save: jest.fn((e: { provider: string; eventId: string }): Promise<unknown> => {
      const key = `${e.provider}:${e.eventId}`;
      if (seenEvents.has(key)) throw uniqueViolation();
      seenEvents.add(key);
      return Promise.resolve(e);
    })
  };
  const coachesRepo = { findOne: jest.fn((): Promise<null> => Promise.resolve(null)) };

  const markPaid = jest.fn((): Promise<Order> => {
    order.status = OrderStatus.PAID;
    return Promise.resolve(order);
  });
  const markFailed = jest.fn((_id: string, reason: string): Promise<Order> => {
    order.status = OrderStatus.FAILED;
    order.failureReason = reason;
    return Promise.resolve(order);
  });
  const markRefunded = jest.fn((): Promise<Order> => {
    order.status = OrderStatus.REFUNDED;
    return Promise.resolve(order);
  });
  const markAwaitingPayment = jest.fn((): Promise<Order> => Promise.resolve(order));
  const orders = { findOrThrow: jest.fn((): Promise<Order> => Promise.resolve(order)), markPaid, markFailed, markRefunded, markAwaitingPayment };

  const grantForPaidOrder = jest.fn((): Promise<unknown> => Promise.resolve({ id: "ent-1" }));
  const revokeForRefund = jest.fn((): Promise<unknown> => Promise.resolve({ id: "ent-1" }));
  const entitlements = { grantForPaidOrder, revokeForRefund };

  const createPayout = jest.fn((): Promise<unknown> => Promise.resolve({ id: "po-1" }));
  const cancelPayout = jest.fn((): Promise<unknown> => Promise.resolve({ id: "po-1" }));
  const payouts = { createForPaidOrder: createPayout, cancelForRefund: cancelPayout };

  const audit = { record: jest.fn((): Promise<void> => Promise.resolve()) };
  const config = { get: jest.fn((k: string, dflt: unknown): unknown => (k === "PAYMENT_WEBHOOK_SECRET" ? SECRET : dflt)) };

  const service = new PaymentService(
    paymentsRepo as never,
    webhookEventsRepo as never,
    coachesRepo as never,
    new MockPaymentProvider(),
    orders as never,
    entitlements as never,
    payouts as never,
    audit as never,
    config as never
  );
  return { service, payments, seenEvents, order, grantForPaidOrder, revokeForRefund, createPayout, cancelPayout, markPaid, markFailed, markRefunded, markAwaitingPayment };
};

const seedPayment = (fx: Fixture, over: Partial<Payment> = {}): Payment => {
  const p: Payment = {
    id: "pay-1",
    orderId: "order-1",
    provider: "mock",
    providerPaymentId: "mock_pi_1",
    amountCents: 10000,
    currency: "USD",
    status: PaymentStatus.PENDING,
    idempotencyKey: "chk-1",
    failureCode: null,
    failureMessage: null,
    paymentMethodRef: null,
    refundedAmountCents: 0,
    providerMetadata: {},
    succeededAt: null,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    order: fx.order,
    ...over
  } as unknown as Payment;
  fx.payments.set(p.id, p);
  return p;
};

const signed = (
  type: "payment.succeeded" | "payment.failed" | "payment.refunded",
  data: { providerPaymentId: string; orderId?: string; amountCents?: number; failureCode?: string; failureMessage?: string },
  eventId = "evt-1"
) => {
  const body = buildMockWebhookEvent(type, data, eventId);
  return signMockWebhook(body, SECRET);
};

describe("successful payment", () => {
  it("moves Payment → Order → Entitlement → Payout exactly once", async () => {
    const fx = setup();
    seedPayment(fx);
    const { body, signature } = signed("payment.succeeded", { providerPaymentId: "mock_pi_1", orderId: "order-1" });

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.markPaid).toHaveBeenCalledTimes(1);
    expect(fx.grantForPaidOrder).toHaveBeenCalledTimes(1);
    expect(fx.createPayout).toHaveBeenCalledTimes(1);
    const stored = fx.payments.get("pay-1")!;
    expect(stored.status).toBe(PaymentStatus.SUCCEEDED);
  });
});

describe("failed payment", () => {
  it("marks payment FAILED and order failed without granting access", async () => {
    const fx = setup();
    seedPayment(fx);
    const { body, signature } = signed(
      "payment.failed",
      { providerPaymentId: "mock_pi_1", orderId: "order-1", failureCode: "card_declined", failureMessage: "Card declined" },
      "evt-fail"
    );

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.markFailed).toHaveBeenCalledWith("order-1", "Card declined");
    expect(fx.grantForPaidOrder).not.toHaveBeenCalled();
    expect(fx.createPayout).not.toHaveBeenCalled();
    expect(fx.payments.get("pay-1")!.status).toBe(PaymentStatus.FAILED);
  });
});

describe("duplicate webhook", () => {
  it("acknowledges the replay without re-applying anything", async () => {
    const fx = setup();
    seedPayment(fx);
    const { body, signature } = signed("payment.succeeded", { providerPaymentId: "mock_pi_1", orderId: "order-1" }, "evt-dup");

    const first = await fx.service.handleWebhook("mock", body, signature);
    const second = await fx.service.handleWebhook("mock", body, signature);

    expect(first).toMatchObject({ ok: true, deduped: false });
    expect(second).toMatchObject({ ok: true, deduped: true });
    expect(fx.grantForPaidOrder).toHaveBeenCalledTimes(1);
    expect(fx.createPayout).toHaveBeenCalledTimes(1);
  });
});

describe("delayed webhook", () => {
  it("ignores a failure arriving after success (no regression)", async () => {
    const fx = setup();
    seedPayment(fx);
    const ok = signed("payment.succeeded", { providerPaymentId: "mock_pi_1", orderId: "order-1" }, "evt-ok");
    await fx.service.handleWebhook("mock", ok.body, ok.signature);

    const late = signed("payment.failed", { providerPaymentId: "mock_pi_1", orderId: "order-1", failureMessage: "late failure" }, "evt-late");
    const result = await fx.service.handleWebhook("mock", late.body, late.signature);

    expect(result).toMatchObject({ ok: true });
    expect(fx.markFailed).not.toHaveBeenCalled();
    expect(fx.payments.get("pay-1")!.status).toBe(PaymentStatus.SUCCEEDED);
    expect(fx.order.status).toBe(OrderStatus.PAID);
  });

  it("reconciles a success that arrives before any local payment row", async () => {
    const fx = setup();
    // No payment seeded: the provider created the intent first.
    const { body, signature } = signed("payment.succeeded", { providerPaymentId: "mock_pi_late", orderId: "order-1" }, "evt-reconcile");

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.markPaid).toHaveBeenCalledTimes(1);
    expect(fx.grantForPaidOrder).toHaveBeenCalledTimes(1);
  });
});

describe("refund", () => {
  it("refunds a succeeded payment and unwinds order → entitlement → payout", async () => {
    const fx = setup(OrderStatus.PAID);
    seedPayment(fx, { status: PaymentStatus.SUCCEEDED });

    const result = await fx.service.refund(BUYER as never, "pay-1");

    expect(result.status).toBe(PaymentStatus.REFUNDED);
    expect(fx.markRefunded).toHaveBeenCalledTimes(1);
    expect(fx.revokeForRefund).toHaveBeenCalledWith("order-1", expect.any(String));
    expect(fx.cancelPayout).toHaveBeenCalledWith("order-1");
  });

  it("rejects refunding a non-succeeded payment", async () => {
    const fx = setup();
    seedPayment(fx, { status: PaymentStatus.PENDING });
    await expect(fx.service.refund(BUYER as never, "pay-1")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("invalid webhook", () => {
  it("rejects a missing signature with 401", async () => {
    const fx = setup();
    const body = buildMockWebhookEvent("payment.succeeded", { providerPaymentId: "mock_pi_1" } as never, "evt-x");
    await expect(fx.service.handleWebhook("mock", body, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a forged signature with 401", async () => {
    const fx = setup();
    const body = buildMockWebhookEvent("payment.succeeded", { providerPaymentId: "mock_pi_1" } as never, "evt-x");
    await expect(fx.service.handleWebhook("mock", body, "t=123,v1=deadbeef")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a tampered body with 401", async () => {
    const fx = setup();
    seedPayment(fx);
    const { body, signature } = signed("payment.succeeded", { providerPaymentId: "mock_pi_1", orderId: "order-1" }, "evt-t");
    await expect(fx.service.handleWebhook("mock", body + "tampered", signature)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects malformed JSON with 400", async () => {
    const fx = setup();
    const { signature } = signMockWebhook("not-json", SECRET);
    await expect(fx.service.handleWebhook("mock", "not-json", signature)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unknown providers with 404", async () => {
    const fx = setup();
    await expect(fx.service.handleWebhook("stripe", "{}", "t=1,v1=aa")).rejects.toThrow("Unknown payment provider");
  });
});

describe("unauthorized access", () => {
  it("forbids checkout of another buyer's order", async () => {
    const fx = setup(OrderStatus.PENDING);
    await expect(fx.service.checkout(STRANGER as never, { orderId: "order-1" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects checkout of an already-paid order", async () => {
    const fx = setup(OrderStatus.PAID);
    await expect(fx.service.checkout(BUYER as never, { orderId: "order-1" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("forbids strangers from reading or refunding payments", async () => {
    const fx = setup(OrderStatus.PAID);
    seedPayment(fx, { status: PaymentStatus.SUCCEEDED });
    await expect(fx.service.getForActor(STRANGER as never, "pay-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(fx.service.refund(STRANGER as never, "pay-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("replays checkout with the same idempotency key instead of double-charging", async () => {
    const fx = setup(OrderStatus.PENDING);
    const first = await fx.service.checkout(BUYER as never, { orderId: "order-1", idempotencyKey: "chk-dup" });
    const second = await fx.service.checkout(BUYER as never, { orderId: "order-1", idempotencyKey: "chk-dup" });
    expect(second.paymentId).toBe(first.paymentId);
  });

  it("rejects an idempotency key already used for a different order", async () => {
    const fx = setup(OrderStatus.PENDING);
    await fx.service.checkout(BUYER as never, { orderId: "order-1", idempotencyKey: "chk-shared" });
    fx.order.id = "order-2";
    await expect(fx.service.checkout(BUYER as never, { orderId: "order-2", idempotencyKey: "chk-shared" })).rejects.toBeInstanceOf(ConflictException);
  });

  it("lists the buyer's own payments", async () => {
    const fx = setup(OrderStatus.PENDING);
    await fx.service.checkout(BUYER as never, { orderId: "order-1", idempotencyKey: "chk-list" });
    const rows = await fx.service.listMine(BUYER as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId: "order-1" });
  });
});

describe("partial refunds", () => {
  it("accumulates a partial refund without unwinding order → entitlement → payout", async () => {
    const fx = setup(OrderStatus.PAID);
    seedPayment(fx, { status: PaymentStatus.SUCCEEDED });
    const { body, signature } = signed("payment.refunded", { providerPaymentId: "mock_pi_1", orderId: "order-1", amountCents: 3000 }, "evt-partial-1");

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.payments.get("pay-1")).toMatchObject({ status: PaymentStatus.PARTIALLY_REFUNDED, refundedAmountCents: 3000 });
    expect(fx.order.status).toBe(OrderStatus.PAID);
    expect(fx.markRefunded).not.toHaveBeenCalled();
    expect(fx.revokeForRefund).not.toHaveBeenCalled();
    expect(fx.cancelPayout).not.toHaveBeenCalled();
  });

  it("unwinds fully once cumulative refunds reach the captured amount", async () => {
    const fx = setup(OrderStatus.PAID);
    seedPayment(fx, { status: PaymentStatus.SUCCEEDED });
    const first = signed("payment.refunded", { providerPaymentId: "mock_pi_1", orderId: "order-1", amountCents: 3000 }, "evt-partial-2a");
    await fx.service.handleWebhook("mock", first.body, first.signature);
    const second = signed("payment.refunded", { providerPaymentId: "mock_pi_1", orderId: "order-1", amountCents: 7000 }, "evt-partial-2b");

    const result = await fx.service.handleWebhook("mock", second.body, second.signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.payments.get("pay-1")).toMatchObject({ status: PaymentStatus.REFUNDED, refundedAmountCents: 10000 });
    expect(fx.markRefunded).toHaveBeenCalledTimes(1);
    expect(fx.revokeForRefund).toHaveBeenCalledWith("order-1", expect.any(String));
    expect(fx.cancelPayout).toHaveBeenCalledWith("order-1");
  });

  it("completes the remainder through a manual refund after a partial webhook", async () => {
    const fx = setup(OrderStatus.PAID);
    seedPayment(fx, { status: PaymentStatus.SUCCEEDED, refundedAmountCents: 3000 });
    fx.payments.get("pay-1")!.status = PaymentStatus.PARTIALLY_REFUNDED;

    const result = await fx.service.refund(BUYER as never, "pay-1");

    expect(result).toMatchObject({ status: PaymentStatus.REFUNDED, refundedAmountCents: 10000 });
    expect(fx.markRefunded).toHaveBeenCalledTimes(1);
  });
});

describe("terminal-state conflicts", () => {
  it("answers 200 (not a retry loop) when funds arrive for a cancelled order", async () => {
    const fx = setup(OrderStatus.CANCELLED);
    seedPayment(fx);
    fx.markPaid.mockRejectedValue(new ConflictException("Order cannot transition from cancelled to paid"));
    const { body, signature } = signed("payment.succeeded", { providerPaymentId: "mock_pi_1", orderId: "order-1" }, "evt-cancel-race");

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: true, reason: "terminal-state-conflict" });
    expect(fx.grantForPaidOrder).not.toHaveBeenCalled();
    expect(fx.createPayout).not.toHaveBeenCalled();
  });

  it("fails the order (instead of stranding it) when a failure names a known order but no payment row exists", async () => {
    const fx = setup(OrderStatus.AWAITING_PAYMENT);
    // No payment seeded: the intent never persisted locally.
    const { body, signature } = signed("payment.failed", { providerPaymentId: "mock_pi_ghost", orderId: "order-1", failureMessage: "expired" }, "evt-ghost-fail");

    const result = await fx.service.handleWebhook("mock", body, signature);

    expect(result).toMatchObject({ ok: true, deduped: false });
    expect(fx.markFailed).toHaveBeenCalledWith("order-1", "expired");
  });
});
