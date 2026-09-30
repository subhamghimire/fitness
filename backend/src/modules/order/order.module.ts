import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { Product } from "src/modules/product/entities/product.entity";
import { MarketplaceAuditModule } from "src/modules/marketplace/audit/marketplace-audit.module";
import { Order } from "./entities/order.entity";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";

/**
 * ORDER MODULE — the purchase state machine (PENDING → AWAITING_PAYMENT →
 * PAID, with FAILED / CANCELLED / REFUNDED branches). Owns the transition
 * table; the payment module drives it but can never bypass it. Exports
 * `OrderService` for checkout, webhook, and refund orchestration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, Product, Coach]), MarketplaceAuditModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService]
})
export class OrderModule {}
