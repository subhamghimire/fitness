export enum OrderStatus {
  /** Created by the buyer; no payment attempt yet. */
  PENDING = "pending",
  /** A payment intent exists with the provider; awaiting the webhook. */
  AWAITING_PAYMENT = "awaiting_payment",
  /** Provider confirmed funds. Entitlement + payout follow. Terminal-good. */
  PAID = "paid",
  /** Provider reported failure (or intent expired). Buyer may retry. */
  FAILED = "failed",
  /** Buyer cancelled before payment. Terminal. */
  CANCELLED = "cancelled",
  /** Funds returned after PAID. Entitlement revoked. Terminal. */
  REFUNDED = "refunded"
}

/**
 * The full transition table. Anything not listed here is rejected — in
 * particular a late/duplicate `payment.failed` webhook can never move a PAID
 * order back to FAILED, which is what makes delayed webhooks safe.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAID, OrderStatus.FAILED, OrderStatus.CANCELLED],
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PAID, OrderStatus.FAILED, OrderStatus.CANCELLED],
  [OrderStatus.FAILED]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}
