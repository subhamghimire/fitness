import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "src/modules/auth/guards/jwt-auth.guard";
import { Roles } from "src/modules/auth/decorators/roles.decorator";
import { RolesGuard } from "src/shared/guards/roles.guard";
import { UserRole } from "src/modules/users/enums";
import { MarketplaceAuditService } from "./marketplace-audit.service";

@ApiTags("Marketplace")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("marketplace/audit-log")
export class MarketplaceAuditController {
  constructor(private readonly audit: MarketplaceAuditService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "List marketplace audit log (admin)" })
  list(
    @Query("action") action?: string,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("limit") limit?: number,
    @Query("offset") offset?: number
  ) {
    return this.audit.list({ action, entityType, entityId, limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined });
  }
}
