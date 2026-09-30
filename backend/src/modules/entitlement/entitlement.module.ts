import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Product } from "src/modules/product/entities/product.entity";
import { MarketplaceAuditModule } from "src/modules/marketplace/audit/marketplace-audit.module";
import { Entitlement } from "./entities/entitlement.entity";
import { EntitlementController } from "./entitlement.controller";
import { EntitlementGuard } from "./entitlement.guard";
import { EntitlementService } from "./entitlement.service";

/**
 * ENTITLEMENT MODULE — access derived strictly from paid orders. The guard
 * it exports is the reusable "Access" gate for any purchased content.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Entitlement, Product]), MarketplaceAuditModule],
  controllers: [EntitlementController],
  providers: [EntitlementService, EntitlementGuard],
  exports: [EntitlementService, EntitlementGuard]
})
export class EntitlementModule {}
