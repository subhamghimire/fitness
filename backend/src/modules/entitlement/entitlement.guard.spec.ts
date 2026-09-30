import { ForbiddenException } from "@nestjs/common";
import { EntitlementGuard } from "./entitlement.guard";
import { ENTITLEMENT_KEY } from "./require-entitlement.decorator";
import { UserRole } from "src/modules/users/enums";

/**
 * ENTITLEMENT GUARD — route-level enforcement for purchased content.
 *
 * Pass-through when no `@RequireEntitlement` metadata is present (so the
 * guard is safe to apply broadly); otherwise buyers need an ACTIVE grant,
 * admins bypass, and strangers get 403.
 */

const buyer = { id: "buyer-1", role: UserRole.USER };
const admin = { id: "admin-1", role: UserRole.ADMIN };

const contextFor = (user: unknown, params: Record<string, string> = { id: "prod-1" }) =>
  ({
    getHandler: () => "handler",
    getClass: () => "class",
    switchToHttp: () => ({ getRequest: () => ({ user, params, query: {} }) })
  }) as never;

const makeGuard = (productParam: string | undefined, hasAccess: boolean) => {
  const reflector = { getAllAndOverride: jest.fn((): string | undefined => productParam) };
  const entitlements = { hasAccess: jest.fn((): Promise<unknown> => Promise.resolve({ hasAccess })) };
  const guard = new EntitlementGuard(reflector as never, entitlements as never);
  return { guard, reflector, entitlements };
};

describe("EntitlementGuard", () => {
  it("passes through when the route declares no product requirement", async () => {
    const { guard, entitlements } = makeGuard(undefined, false);
    await expect(guard.canActivate(contextFor(buyer))).resolves.toBe(true);
    expect(entitlements.hasAccess).not.toHaveBeenCalled();
    expect(ENTITLEMENT_KEY).toBe("entitlement:product-param");
  });

  it("allows buyers with an active grant", async () => {
    const { guard, entitlements } = makeGuard("id", true);
    await expect(guard.canActivate(contextFor(buyer))).resolves.toBe(true);
    expect(entitlements.hasAccess).toHaveBeenCalledWith("buyer-1", "prod-1");
  });

  it("forbids buyers without a grant", async () => {
    const { guard } = makeGuard("id", false);
    await expect(guard.canActivate(contextFor(buyer))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets admins bypass for support", async () => {
    const { guard, entitlements } = makeGuard("id", false);
    await expect(guard.canActivate(contextFor(admin))).resolves.toBe(true);
    expect(entitlements.hasAccess).not.toHaveBeenCalled();
  });
});
