import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { User } from "src/modules/users/entities/user.entity";
import { UserRole } from "src/modules/users/enums";
import { EntitlementService } from "./entitlement.service";
import { ENTITLEMENT_KEY } from "./require-entitlement.decorator";

/**
 * ENTITLEMENT GUARD — the "Access" end of Payment → Order → Entitlement →
 * Access. Any controller serving purchased content adds
 * `@RequireEntitlement("<productId param>")`; buyers without an ACTIVE,
 * unexpired entitlement for that product get a 403. Admins bypass (support),
 * unauthenticated requests get a 401 from the JWT guard first.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const productParam = this.reflector.getAllAndOverride<string>(ENTITLEMENT_KEY, [context.getHandler(), context.getClass()]);
    if (!productParam) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException("Authentication required");
    if (user.role === UserRole.ADMIN) return true;

    const productId = (request.params?.[productParam] as string | undefined) ?? (request.query?.[productParam] as string | undefined);
    if (!productId) throw new ForbiddenException("Product reference is required");
    const { hasAccess } = await this.entitlements.hasAccess(user.id, productId);
    if (!hasAccess) throw new ForbiddenException("An active purchase is required to access this content");
    return true;
  }
}
