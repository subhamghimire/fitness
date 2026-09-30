export enum PaymentStatus {
  /** Intent created locally; not yet sent to / acknowledged by provider. */
  CREATED = "created",
  /** Intent registered with provider; awaiting buyer action + webhook. */
  PENDING = "pending",
  /** Provider is processing the charge. */
  PROCESSING = "processing",
  /** Provider confirmed funds. Terminal-good (until a refund). */
  SUCCEEDED = "succeeded",
  /** Part of the funds returned; the remainder is still captured. */
  PARTIALLY_REFUNDED = "partially_refunded",
  /** Provider reported failure. Terminal. A retry creates a NEW payment row. */
  FAILED = "failed",
  /** Cancelled before completion. Terminal. */
  CANCELED = "canceled",
  /** Funds returned after SUCCEEDED. Terminal. */
  REFUNDED = "refunded"
}

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELED],
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELED],
  [PaymentStatus.SUCCEEDED]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELED]: [],
  [PaymentStatus.REFUNDED]: []
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

/** Webhook event types normalised across providers. */
export enum ProviderWebhookType {
  PAYMENT_SUCCEEDED = "payment.succeeded",
  PAYMENT_FAILED = "payment.failed",
  PAYMENT_REFUNDED = "payment.refunded",
  UNKNOWN = "unknown"
}
