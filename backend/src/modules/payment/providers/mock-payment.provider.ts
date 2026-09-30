import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { ProviderWebhookType } from "../enums/payment-status.enum";
import { CreatedPaymentIntent, CreatedRefund, CreatePaymentIntentInput, NormalisedWebhookEvent, PaymentProvider, RefundInput } from "./payment-provider.interface";

/**
 * MOCK PAYMENT PROVIDER — the default (`PAYMENT_PROVIDER=mock`).
 *
 * Behaves like a real provider at the seam level (intent creation, HMAC-signed
 * webhooks, refunds) without touching money or card data, so the full
 * Payment → Order → Entitlement → Payout flow is exercisable in dev, CI, and
 * tests. A Stripe implementation would satisfy the same interface; services
 * never import this class directly (see `PAYMENT_PROVIDER_TOKEN`).
 *
 * Webhook wire format (JSON body, header `x-payment-signature`):
 *   body:      {"id":"evt_…","type":"payment.succeeded"|"payment.failed"|"payment.refunded",
 *               "data":{"providerPaymentId":"mock_pi_…","orderId":"…","amountCents":…,
 *                        "failureCode":"…","failureMessage":"…"},"created":1699999999}
 *   signature: "t=<unix>,v1=<hex HMAC-SHA256("<t>.<rawBody>", secret)>"
 *
 * Replays are ALWAYS safe regardless of age: timestamp is part of the signed
 * material (so it cannot be tampered with) but expiry is intentionally NOT
 * enforced — a delayed-but-genuine redelivery must still be accepted and then
 * neutralised by the event-id dedupe ledger, not rejected.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatedPaymentIntent> {
    void input;
    const providerPaymentId = `mock_pi_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    return Promise.resolve({
      providerPaymentId,
      clientSecret: `${providerPaymentId}_secret_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      providerStatus: "requires_payment_method"
    });
  }

  refund(input: RefundInput): Promise<CreatedRefund> {
    void input;
    return Promise.resolve({ providerRefundId: `mock_re_${randomUUID().replace(/-/g, "").slice(0, 24)}` });
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret: string): void {
    if (!signature) throw new UnauthorizedException("Missing webhook signature");
    const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(signature.trim());
    if (!match) throw new UnauthorizedException("Malformed webhook signature");
    const [, timestamp, presented] = match;
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`, "utf8").digest("hex");
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException("Invalid webhook signature");
  }

  parseWebhookEvent(rawBody: string | Buffer): NormalisedWebhookEvent {
    const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("Webhook body is not valid JSON");
    }
    if (typeof parsed.id !== "string" || typeof parsed.type !== "string" || typeof parsed.data !== "object" || parsed.data === null) {
      throw new BadRequestException("Webhook event is missing id/type/data");
    }
    const data = parsed.data as Record<string, unknown>;
    if (typeof data.providerPaymentId !== "string") throw new BadRequestException("Webhook event data is missing providerPaymentId");
    return {
      eventId: parsed.id,
      type: this.normaliseType(parsed.type),
      providerPaymentId: data.providerPaymentId,
      orderId: typeof data.orderId === "string" ? data.orderId : null,
      amountCents: typeof data.amountCents === "number" ? data.amountCents : null,
      failureCode: typeof data.failureCode === "string" ? data.failureCode : null,
      failureMessage: typeof data.failureMessage === "string" ? data.failureMessage : null,
      occurredAt: typeof parsed.created === "number" ? new Date(parsed.created * 1000) : null
    };
  }

  private normaliseType(type: string): ProviderWebhookType {
    switch (type) {
      case "payment.succeeded":
        return ProviderWebhookType.PAYMENT_SUCCEEDED;
      case "payment.failed":
        return ProviderWebhookType.PAYMENT_FAILED;
      case "payment.refunded":
        return ProviderWebhookType.PAYMENT_REFUNDED;
      default:
        return ProviderWebhookType.UNKNOWN;
    }
  }
}

/** Test/dev helper: build a signed mock webhook (body + signature header). */
export function signMockWebhook(body: string, secret: string, timestamp?: number): { body: string; signature: string } {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return { body, signature: `t=${t},v1=${v1}` };
}

export function buildMockWebhookEvent(
  type: "payment.succeeded" | "payment.failed" | "payment.refunded",
  data: { providerPaymentId: string; orderId?: string; amountCents?: number; failureCode?: string; failureMessage?: string },
  eventId?: string
): string {
  return JSON.stringify({
    id: eventId ?? `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data
  });
}
