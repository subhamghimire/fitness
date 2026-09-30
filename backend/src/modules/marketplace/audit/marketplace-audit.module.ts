import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MarketplaceAuditLog } from "./marketplace-audit-log.entity";
import { MarketplaceAuditService } from "./marketplace-audit.service";
import { MarketplaceAuditController } from "./marketplace-audit.controller";

@Module({
  imports: [TypeOrmModule.forFeature([MarketplaceAuditLog])],
  controllers: [MarketplaceAuditController],
  providers: [MarketplaceAuditService],
  exports: [MarketplaceAuditService]
})
export class MarketplaceAuditModule {}
