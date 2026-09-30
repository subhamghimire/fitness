/**
 * Platform fee math. Single source of truth for the gross → fee → net split
 * so Order (snapshot at purchase), Payout (coach earnings), and tests can
 * never disagree.
 *
 * Amounts are minor units (cents). The fee is rounded DOWN so the platform
 * never takes more than `feeBps` basis points and `fee + net === amount`
 * always holds.
 */
export const DEFAULT_PLATFORM_FEE_BPS = 1000; // 10%

export interface MarketplaceSplit {
  feeCents: number;
  netCents: number;
}

export function calculateMarketplaceSplit(amountCents: number, feeBps: number = DEFAULT_PLATFORM_FEE_BPS): MarketplaceSplit {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) throw new Error("feeBps must be an integer between 0 and 10000");
  const feeCents = Math.floor((amountCents * feeBps) / 10000);
  return { feeCents, netCents: amountCents - feeCents };
}
