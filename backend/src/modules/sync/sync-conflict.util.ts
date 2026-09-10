/**
 * Shared server-side LWW helpers (mirrors mobile sync/conflict.ts).
 */
export function resolveWinner(
  clientLocalUpdatedAt: string,
  serverUpdatedAt: Date | null | undefined,
  clientRevision: number,
  serverRevision: number,
  opts?: { clientDeleted?: boolean; serverDeleted?: boolean }
): "client" | "server" {
  if (opts?.clientDeleted && !opts?.serverDeleted) {
    const clientMs = Date.parse(clientLocalUpdatedAt);
    const serverMs = serverUpdatedAt ? serverUpdatedAt.getTime() : 0;
    return clientMs >= serverMs ? "client" : "server";
  }
  if (opts?.serverDeleted && !opts?.clientDeleted) {
    const clientMs = Date.parse(clientLocalUpdatedAt);
    const serverMs = serverUpdatedAt ? serverUpdatedAt.getTime() : 0;
    return serverMs >= clientMs ? "server" : "client";
  }

  const clientMs = Date.parse(clientLocalUpdatedAt);
  const serverMs = serverUpdatedAt ? serverUpdatedAt.getTime() : 0;
  if (clientMs > serverMs) return "client";
  if (clientMs < serverMs) return "server";
  if (clientRevision > serverRevision) return "client";
  if (clientRevision < serverRevision) return "server";
  return "server";
}

export function isIdempotentReplay(
  existingRevision: number | null | undefined,
  incomingRevision: number
): boolean {
  return existingRevision != null && existingRevision === incomingRevision;
}
