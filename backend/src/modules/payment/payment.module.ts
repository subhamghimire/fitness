import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Coach } from "src/modules/coach/entities/coach.entity";
import { OrderModule } from "src/modules/order/order.module";
import { EntitlementModule } from "src/modules/entitlement/entitlement.module";
import { PayoutModule } from "src/modules/payout/payout.module";
import { MarketplaceAuditModule } from "src/modules/marketplace/audit/marketplace-audit.module";
import { Payment } from "./entities/payment.entity";
import { ProcessedWebhookEvent } from "./entities/processed-webhook-event.entity";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { PAYMENT_PROVIDER_TOKEN } from "./providers/payment-provider.interface";
import { MockPaymentProvider } from "./providers/mock-payment.provider";

/**
 * PAYMENT MODULE — provider orchestration with a swappable provider.
 *
 * Business logic depends on the `PaymentProvider` interface behind
 * `PAYMENT_PROVIDER_TOKEN`, never on a concrete SDK. Today the token resolves
 * to `MockPaymentProvider` (set `PAYMENT_PROVIDER` + secrets in env when a
 * real provider implementation lands — no service changes needed).
 *
 * Drives the core flow on webhook confirmation: Payment → Order →
 * Entitlement → Payout. Imports the three downstream modules but none of them
 * import this one, so the graph stays acyclic.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Payment, ProcessedWebhookEvent, Coach]), OrderModule, EntitlementModule, PayoutModule, MarketplaceAuditModule],
  controllers: [PaymentController],
  providers: [
    {
      provide: PAYMENT_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const name = (config.get<string>("PAYMENT_PROVIDER", "mock") ?? "mock").toLowerCase();
        // Only "mock" exists yet; unknown names fail closed to the mock rather
        // than crashing boot, but loudly, so a typo can't take payments down.
        if (name !== "mock") throw new Error(`Unsupported PAYMENT_PROVIDER="${name}" (only "mock" is implemented)`);
        return new MockPaymentProvider();
      }
    },
    PaymentService
  ],
  exports: [PaymentService, PAYMENT_PROVIDER_TOKEN]
})
export class PaymentModule {}
