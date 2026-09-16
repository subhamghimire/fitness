/**
 * Shared server-side LWW helpers (mirrors mobile sync/conflict.ts).
 *
 * Conflict resolution uses the CLIENT mutation timestamp for both sides,
 * never the server receive time.
 *
 *   incomingClientUpdatedAt  – from the push request (what the client last touched)
 *   existingClientUpdatedAt  – stored on the entity from the last accepted push;
 *                               falls back to updatedAt for pre-migration rows
 *
 * Pre-migration rows have no clientUpdatedAt yet; the caller passes
 * `entity.clientUpdatedAt ?? entity.updatedAt` so the comparison degrades
 * gracefully to the old behaviour for legacy data.
 */
export function resolveWinner(
  incomingClientUpdatedAt: string | Date | null | undefined,
  existingClientUpdatedAt: Date | null | undefined,
  clientRevision: number,
  serverRevision: number,
  opts?: { clientDeleted?: boolean; serverDeleted?: boolean }
): "client" | "server" {
  const clientMs = toMs(incomingClientUpdatedAt);
  const serverMs = toMs(existingClientUpdatedAt);

  if (opts?.clientDeleted && !opts?.serverDeleted) {
    return clientMs >= serverMs ? "client" : "server";
  }
  if (opts?.serverDeleted && !opts?.clientDeleted) {
    return serverMs >= clientMs ? "server" : "client";
  }

  if (clientMs > serverMs) return "client";
  if (clientMs < serverMs) return "server";
  if (clientRevision > serverRevision) return "client";
  if (clientRevision < serverRevision) return "server";
  return "server";
}

export function isIdempotentReplay(
  existingRevision: number | null | undefined,
  incomingRevision: number,
  existingClientUpdatedAt?: string | Date | null,
  incomingClientUpdatedAt?: string | Date | null
): boolean {
  if (existingRevision == null || existingRevision !== incomingRevision) return false;
  // Same revision number alone is insufficient: two different devices can
  // independently bump a shared entity to the same revision and then diverge.
  // Only treat the push as a replay of the very same logical mutation when the
  // client mutation timestamp also matches the one the server already has.
  if (existingClientUpdatedAt != null || incomingClientUpdatedAt != null) {
    return toMs(existingClientUpdatedAt) === toMs(incomingClientUpdatedAt);
  }
  return true;
}

function toMs(v: string | Date | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "string") return Date.parse(v) || 0;
  return v.getTime() || 0;
}
