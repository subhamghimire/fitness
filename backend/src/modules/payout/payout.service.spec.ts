import { ConflictException, ForbiddenException } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import { Payout } from "./entities/payout.entity";
import { Order } from "src/modules/order/entities/order.entity";
import { PayoutStatus } from "./enums/payout-status.enum";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { UserRole } from "src/modules/users/enums";

/**
 * PAYOUT SERVICE
 *
 * Money math is frozen at purchase: the payout copies the order snapshot, so
 * `net = amount − fee` always holds. Creation is idempotent per order, the
 * status machine only moves forward under admin control, and refunds cancel
 * unprocessed payouts while leaving PAID ones for manual clawback.
 */

const ADMIN = { id: "admin-1", role: UserRole.ADMIN } as never;
const COACH_USER = { id: "coach-user-1", role: UserRole.USER } as never;
const OTHER_COACH_USER = { id: "other-coach-user-1", role: UserRole.USER } as never;

const paidOrder = (): Order =>
  ({
    id: "order-1",
    buyerId: "buyer-1",
    coachId: "coach-1",
    productId: "prod-1",
    amountCents: 10000,
    currency: "USD",
    feeCents: 1000,
    netCents: 9000,
    status: OrderStatus.PAID
  }) as unknown as Order;

const makeService = () => {
  let stored: Payout | null = null;
  const payouts = {
    findOne: jest.fn(({ where }: { where: Partial<Payout> }): Promise<Payout | null> => {
      if (!stored) return Promise.resolve(null);
      if (where.id && stored.id !== where.id) return Promise.resolve(null);
      if (where.orderId && stored.orderId !== where.orderId) return Promise.resolve(null);
      if (where.isDeleted !== undefined && stored.isDeleted !== where.isDeleted) return Promise.resolve(null);
      return Promise.resolve(stored);
    }),
    create: jest.fn((d: Partial<Payout>): Payout => ({ id: "payout-1", isDeleted: false, createdAt: new Date(), updatedAt: new Date(), ...d }) as unknown as Payout),
    save: jest.fn((p: Payout): Promise<Payout> => {
      stored = p;
      return Promise.resolve(p);
    })
  };
  const coaches = {
    findOne: jest.fn(
      ({ where }: { where: { userId?: string } }): Promise<unknown> => Promise.resolve(where.userId === "coach-user-1" ? { id: "coach-1", userId: "coach-user-1" } : null)
    )
  };
  const audit = { record: jest.fn((): Promise<void> => Promise.resolve()) };
  const service = new PayoutService(payouts as never, coaches as never, audit as never);
  return { service, payouts };
};

describe("createForPaidOrder", () => {
  it("copies the order money snapshot (amount − fee = net)", async () => {
    const { service } = makeService();
    const payout = await service.createForPaidOrder(paidOrder());
    expect(payout.amountCents).toBe(10000);
    expect(payout.feeCents).toBe(1000);
    expect(payout.netCents).toBe(9000);
    expect(payout.netCents).toBe(payout.amountCents - payout.feeCents);
    expect(payout.status).toBe(PayoutStatus.PENDING);
    expect(payout.payoutReference).toMatch(/^po_/);
  });

  it("is idempotent per order", async () => {
    const { service, payouts } = makeService();
    const first = await service.createForPaidOrder(paidOrder());
    const second = await service.createForPaidOrder(paidOrder());
    expect(second.id).toBe(first.id);
    expect(payouts.create).toHaveBeenCalledTimes(1);
  });

  it("refuses unpaid orders", async () => {
    const { service } = makeService();
    await expect(service.createForPaidOrder({ ...paidOrder(), status: OrderStatus.AWAITING_PAYMENT } as unknown as Order)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("cancelForRefund", () => {
  it("cancels a PENDING payout", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    const cancelled = await service.cancelForRefund("order-1");
    expect(cancelled!.status).toBe(PayoutStatus.CANCELED);
  });

  it("leaves a PAID payout for manual clawback", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    await service.setStatus(ADMIN, "payout-1", PayoutStatus.PROCESSING);
    await service.setStatus(ADMIN, "payout-1", PayoutStatus.PAID);
    const kept = await service.cancelForRefund("order-1");
    expect(kept!.status).toBe(PayoutStatus.PAID);
  });
});

describe("setStatus", () => {
  it("moves PENDING → PROCESSING → PAID and rejects skips/backwards moves", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    await expect(service.setStatus(ADMIN, "payout-1", PayoutStatus.PROCESSING)).resolves.toMatchObject({ status: PayoutStatus.PROCESSING });
    await expect(service.setStatus(ADMIN, "payout-1", PayoutStatus.PAID)).resolves.toMatchObject({ status: PayoutStatus.PAID });
    await expect(service.setStatus(ADMIN, "payout-1", PayoutStatus.FAILED)).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a direct PENDING → PAID jump", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    await expect(service.setStatus(ADMIN, "payout-1", PayoutStatus.PAID)).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects non-admins", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    await expect(service.setStatus(COACH_USER, "payout-1", PayoutStatus.PROCESSING)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("visibility (unauthorized access)", () => {
  it("lets the owning coach and admins read; forbids other coaches", async () => {
    const { service } = makeService();
    await service.createForPaidOrder(paidOrder());
    await expect(service.getForActor(COACH_USER, "payout-1")).resolves.toMatchObject({ id: "payout-1" });
    await expect(service.getForActor(ADMIN, "payout-1")).resolves.toMatchObject({ id: "payout-1" });
    await expect(service.getForActor(OTHER_COACH_USER, "payout-1")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
