export const MarketplaceAuditAction = {
  PRODUCT_CREATED: "product.created",
  PRODUCT_UPDATED: "product.updated",
  PRODUCT_PUBLISHED: "product.published",
  PRODUCT_UNPUBLISHED: "product.unpublished",
  PRODUCT_ARCHIVED: "product.archived",
  ORDER_CREATED: "order.created",
  ORDER_PAID: "order.paid",
  ORDER_FAILED: "order.failed",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_REFUNDED: "order.refunded",
  PAYMENT_CREATED: "payment.created",
  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_PARTIALLY_REFUNDED: "payment.partially_refunded",
  PAYMENT_REFUNDED: "payment.refunded",
  WEBHOOK_RECEIVED: "webhook.received",
  WEBHOOK_DEDUPLICATED: "webhook.deduplicated",
  WEBHOOK_REJECTED: "webhook.rejected",
  WEBHOOK_STALE_IGNORED: "webhook.stale_ignored",
  ENTITLEMENT_GRANTED: "entitlement.granted",
  ENTITLEMENT_REVOKED: "entitlement.revoked",
  PAYOUT_CREATED: "payout.created",
  PAYOUT_STATUS_CHANGED: "payout.status_changed",
  PAYOUT_CANCELLED: "payout.cancelled"
} as const;

export type MarketplaceAuditAction = (typeof MarketplaceAuditAction)[keyof typeof MarketplaceAuditAction];
