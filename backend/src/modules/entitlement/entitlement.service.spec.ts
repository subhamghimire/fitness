import { ForbiddenException } from "@nestjs/common";
import { EntitlementService } from "./entitlement.service";
import { Entitlement } from "./entities/entitlement.entity";
import { EntitlementStatus } from "./enums/entitlement-status.enum";
import { Order } from "src/modules/order/entities/order.entity";
import { OrderStatus } from "src/modules/order/enums/order-status.enum";
import { UserRole } from "src/modules/users/enums";

/**
 * ENTITLEMENT SERVICE
 *
 * The property under test: access derives ONLY from confirmed payment.
 * Granting for anything but a PAID order throws; a refund revokes; replays
 * converge on the existing row.
 */

const OWNER = { id: "buyer-1", role: UserRole.USER } as never;
const STRANGER = { id: "stranger-1", role: UserRole.USER } as never;

const paidOrder = (): Order =>
  ({
    id: "order-1",
    buyerId: "buyer-1",
    coachId: "coach-1",
    productId: "prod-1",
    status: OrderStatus.PAID
  }) as unknown as Order;

const matches = (stored: Entitlement, where: Partial<Entitlement>): boolean => {
  if (where.orderId && stored.orderId !== where.orderId) return false;
  if (where.buyerId && stored.buyerId !== where.buyerId) return false;
  if (where.productId && stored.productId !== where.productId) return false;
  if (where.status && stored.status !== where.status) return false;
  if (where.isDeleted !== undefined && stored.isDeleted !== where.isDeleted) return false;
  return true;
};

const makeService = () => {
  let stored: Entitlement | null = null;
  const entitlements = {
    findOne: jest.fn(({ where }: { where: Partial<Entitlement> }): Promise<Entitlement | null> => Promise.resolve(stored && matches(stored, where) ? stored : null)),
    create: jest.fn((d: Partial<Entitlement>): Entitlement => ({ id: "ent-1", isDeleted: false, ...d }) as unknown as Entitlement),
    find: jest.fn((): Promise<Entitlement[]> => Promise.resolve(stored ? [stored] : [])),
    save: jest.fn((e: Entitlement): Promise<Entitlement> => {
      stored = e;
      return Promise.resolve(e);
    })
  };
  const products = { findOne: jest.fn((): Promise<unknown> => Promise.resolve({ id: "prod-1", billingInterval: null })) };
  const audit = { record: jest.fn((): Promise<void> => Promise.resolve()) };
  const service = new EntitlementService(entitlements as never, products as never, audit as never);
  const mutateStored = (patch: Partial<Entitlement>): void => {
    if (stored) stored = { ...stored, ...patch } as unknown as Entitlement;
  };
  return { service, entitlements, mutateStored };
};

describe("grantForPaidOrder", () => {
  it("grants ACTIVE access for a PAID order", async () => {
    const { service } = makeService();
    const granted = await service.grantForPaidOrder(paidOrder());
    expect(granted.status).toBe(EntitlementStatus.ACTIVE);
    expect(granted.buyerId).toBe("buyer-1");
    expect(granted.orderId).toBe("order-1");
  });

  it("refuses to grant for an unpaid order (no access before confirmed payment)", async () => {
    const { service, entitlements } = makeService();
    for (const status of [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT, OrderStatus.FAILED]) {
      await expect(service.grantForPaidOrder({ ...paidOrder(), status } as unknown as Order)).rejects.toThrow();
    }
    expect(entitlements.save).not.toHaveBeenCalled();
  });

  it("is idempotent: a replayed grant returns the existing row", async () => {
    const { service, entitlements } = makeService();
    const first = await service.grantForPaidOrder(paidOrder());
    const second = await service.grantForPaidOrder(paidOrder());
    expect(second.id).toBe(first.id);
    expect(entitlements.create).toHaveBeenCalledTimes(1);
  });
});

describe("revokeForRefund", () => {
  it("revokes an ACTIVE entitlement and cuts access", async () => {
    const { service } = makeService();
    await service.grantForPaidOrder(paidOrder());
    const revoked = await service.revokeForRefund("order-1", "payment refunded");
    expect(revoked!.status).toBe(EntitlementStatus.REVOKED);
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: false });
  });

  it("is idempotent and tolerates a missing row", async () => {
    const { service } = makeService();
    await expect(service.revokeForRefund("order-unknown", "x")).resolves.toBeNull();
    await service.grantForPaidOrder(paidOrder());
    const first = await service.revokeForRefund("order-1", "x");
    const second = await service.revokeForRefund("order-1", "x");
    expect(second!.id).toBe(first!.id);
  });
});

describe("hasAccess / visibility (unauthorized access)", () => {
  it("reports access only for ACTIVE, unexpired entitlements", async () => {
    const { service } = makeService();
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: false });
    await service.grantForPaidOrder(paidOrder());
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: true, entitlementId: "ent-1" });
  });

  it("expires lapsed subscriptions on read", async () => {
    const { service, mutateStored } = makeService();
    await service.grantForPaidOrder(paidOrder());
    mutateStored({ expiresAt: new Date(Date.now() - 1000) });
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: false });
  });

  it("forbids strangers from reading another buyer's entitlement", async () => {
    const { service } = makeService();
    await service.grantForPaidOrder(paidOrder());
    await expect(service.getForActor(OWNER, "ent-1")).resolves.toMatchObject({ id: "ent-1" });
    await expect(service.getForActor(STRANGER, "ent-1")).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("expireDue (subscription sweep)", () => {
  it("expires lapsed rows and reports the count; second run is a no-op", async () => {
    const { service, entitlements } = makeService();
    await service.grantForPaidOrder(paidOrder());
    entitlements.find.mockImplementation(
      (): Promise<Entitlement[]> =>
        Promise.resolve([
          {
            id: "ent-1",
            buyerId: "buyer-1",
            status: EntitlementStatus.ACTIVE,
            expiresAt: new Date(Date.now() - 1000),
            isDeleted: false
          } as unknown as Entitlement
        ])
    );

    await expect(service.expireDue()).resolves.toBe(1);
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: false });
  });

  it("leaves lifetime (null-expiry) entitlements alone", async () => {
    const { service, entitlements } = makeService();
    await service.grantForPaidOrder(paidOrder());
    entitlements.find.mockImplementation((): Promise<Entitlement[]> => Promise.resolve([]));

    await expect(service.expireDue()).resolves.toBe(0);
    await expect(service.hasAccess("buyer-1", "prod-1")).resolves.toMatchObject({ hasAccess: true });
  });
});
