import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";

@Injectable()
export class DisabledRouteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.originalUrl;

    // Simulate "route not found" error with a custom message
    throw new NotFoundException(`Cannot ${method} ${url}`);
  }
}
