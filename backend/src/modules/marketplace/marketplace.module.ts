import { Module } from "@nestjs/common";
import { EntitlementModule } from "src/modules/entitlement/entitlement.module";
import { OrderModule } from "src/modules/order/order.module";
import { PaymentModule } from "src/modules/payment/payment.module";
import { PayoutModule } from "src/modules/payout/payout.module";
import { ProductModule } from "src/modules/product/product.module";
import { MarketplaceAuditModule } from "./audit/marketplace-audit.module";

/**
 * MARKETPLACE MODULE — composition root for coach monetization.
 *
 * Bounded modules, one direction of money:
 *
 *   Product (price list) → Order (state machine) → Payment (provider +
 *   webhooks) → Entitlement (access) → Payout (coach earnings),
 *   with MarketplaceAuditModule as the append-only paper trail.
 *
 * No marketplace module imports sideways: PaymentModule is the only one with
 * cross-module imports (Order/Entitlement/Payout, all one-directional), and
 * nothing outside the marketplace imports these modules' internals — the
 * reusable seam for the rest of the app is `EntitlementGuard` +
 * `@RequireEntitlement` (see EntitlementModule) for gating purchased content.
 */
@Module({
  imports: [MarketplaceAuditModule, ProductModule, OrderModule, PaymentModule, EntitlementModule, PayoutModule],
  exports: [MarketplaceAuditModule, ProductModule, OrderModule, PaymentModule, EntitlementModule, PayoutModule]
})
export class MarketplaceModule {}
