import { ProviderWebhookType } from "../enums/payment-status.enum";

/**
 * PAYMENT PROVIDER ABSTRACTION.
 *
 * Business logic (orders, entitlements, payouts) depends ONLY on this
 * interface — never on a concrete provider SDK. Adding Stripe/SSLCommerz/
 * bKash later means writing one new class implementing these four methods
 * plus a `parseWebhookEvent` mapping; no service changes.
 */
export interface CreatePaymentIntentInput {
  orderId: string;
  amountCents: number;
  currency: string;
  buyerId: string;
  idempotencyKey: string;
}

export interface CreatedPaymentIntent {
  providerPaymentId: string;
  /** Client-side confirmation secret (opaque to us). */
  clientSecret: string;
  providerStatus: string;
}

export interface RefundInput {
  providerPaymentId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface CreatedRefund {
  providerRefundId: string;
}

export interface NormalisedWebhookEvent {
  eventId: string;
  type: ProviderWebhookType;
  /** Provider's payment/intent id this event is about. */
  providerPaymentId: string;
  /** Our order id, when the provider echoes it back (may be absent on delayed events). */
  orderId: string | null;
  amountCents: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  occurredAt: Date | null;
}

export interface PaymentProvider {
  readonly name: string;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatedPaymentIntent>;
  refund(input: RefundInput): Promise<CreatedRefund>;
  /** Throws on invalid signature — the caller turns that into a 401. */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret: string): void;
  /** Throws on malformed payload — the caller turns that into a 400. */
  parseWebhookEvent(rawBody: string | Buffer): NormalisedWebhookEvent;
}

export const PAYMENT_PROVIDER_TOKEN = "PAYMENT_PROVIDER";
