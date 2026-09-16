import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { UserRole } from "../../modules/users/enums";
import { ROLES_KEY } from "../../modules/auth/decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { role?: UserRole } | undefined;
    if (!user?.role) {
      throw new ForbiddenException("Insufficient role");
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException("Requires admin role");
    }
    return true;
  }
}
