import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { MarketplaceAuditModule } from "src/modules/marketplace/audit/marketplace-audit.module";
import { Payout } from "./entities/payout.entity";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";

/**
 * PAYOUT MODULE — the coach earnings ledger. Amounts are copied from the
 * paid order's snapshot; status moves under admin control only.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payout, Coach]), MarketplaceAuditModule],
  controllers: [PayoutController],
  providers: [PayoutService],
  exports: [PayoutService]
})
export class PayoutModule {}
