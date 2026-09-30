import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { EntitlementModule } from "src/modules/entitlement/entitlement.module";
import { ProgramModule } from "src/modules/program/program.module";
import { MarketplaceAuditModule } from "src/modules/marketplace/audit/marketplace-audit.module";
import { Product } from "./entities/product.entity";
import { ProductController } from "./product.controller";
import { ProductService } from "./product.service";

/**
 * PRODUCT MODULE — the sellable catalog (training programs, digital plans,
 * coaching packages, subscriptions). Owns the price list; owns nothing about
 * money movement. Bounded: imports only the audit writer, coach reads for
 * ownership checks, the entitlement service for the purchased-content read,
 * and the program service for resolving training-program content. Neither
 * dependency points back here, so the graph stays acyclic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, Coach]), MarketplaceAuditModule, EntitlementModule, ProgramModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService]
})
export class ProductModule {}
