import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers["x-api-key"] as string;

    const validApiKey = this.configService.get<string>("x-api-key");
    if (!apiKey || apiKey !== validApiKey) {
      throw new ForbiddenException("Invalid or missing [x-api-key] API key");
    }

    return true;
  }
}
