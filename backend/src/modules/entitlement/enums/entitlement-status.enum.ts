export enum EntitlementStatus {
  /** Buyer may access the purchased offering. */
  ACTIVE = "active",
  /** Access withdrawn (refund / manual revocation). Terminal. */
  REVOKED = "revoked",
  /** Subscription period lapsed. Terminal. */
  EXPIRED = "expired"
}
