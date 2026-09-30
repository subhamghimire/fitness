export enum PayoutStatus {
  /** Created alongside the paid order; awaiting admin processing. */
  PENDING = "pending",
  /** Handed to the payout rail; awaiting confirmation. */
  PROCESSING = "processing",
  /** Coach received funds. Terminal-good. */
  PAID = "paid",
  /** Rail reported failure; may be retried to PROCESSING. */
  FAILED = "failed",
  /** Cancelled (order refunded before payout). Terminal. */
  CANCELED = "canceled"
}

export const PAYOUT_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  [PayoutStatus.PENDING]: [PayoutStatus.PROCESSING, PayoutStatus.CANCELED],
  [PayoutStatus.PROCESSING]: [PayoutStatus.PAID, PayoutStatus.FAILED],
  [PayoutStatus.FAILED]: [PayoutStatus.PROCESSING, PayoutStatus.CANCELED],
  [PayoutStatus.PAID]: [],
  [PayoutStatus.CANCELED]: []
};

export function canTransitionPayout(from: PayoutStatus, to: PayoutStatus): boolean {
  return (PAYOUT_TRANSITIONS[from] ?? []).includes(to);
}
