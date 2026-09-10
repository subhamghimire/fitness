/**
 * Conflict resolution helpers for offline-first sync.
 *
 * Strategies (per plan):
 * - Workout / exercise / set / template rows: last-write-wins by localUpdatedAt
 * - Tie-break: higher revision, then prefer server
 * - Soft delete vs update: delete wins if delete.localUpdatedAt >= update.localUpdatedAt
 */

export type ResolveWinner = 'client' | 'server';

export interface ConflictTimestamps {
  clientLocalUpdatedAt: string;
  serverUpdatedAt: string;
  clientRevision: number;
  serverRevision: number;
  clientDeleted?: boolean;
  serverDeleted?: boolean;
}

export function compareIso(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return -1;
  if (Number.isNaN(tb)) return 1;
  return ta - tb;
}

export function resolveLww(input: ConflictTimestamps): ResolveWinner {
  if (input.clientDeleted && !input.serverDeleted) {
    return compareIso(input.clientLocalUpdatedAt, input.serverUpdatedAt) >= 0 ? 'client' : 'server';
  }
  if (input.serverDeleted && !input.clientDeleted) {
    return compareIso(input.serverUpdatedAt, input.clientLocalUpdatedAt) >= 0 ? 'server' : 'client';
  }

  const byTime = compareIso(input.clientLocalUpdatedAt, input.serverUpdatedAt);
  if (byTime > 0) return 'client';
  if (byTime < 0) return 'server';
  if (input.clientRevision > input.serverRevision) return 'client';
  if (input.clientRevision < input.serverRevision) return 'server';
  return 'server';
}

export function shouldApplyServerChange(params: {
  localRevision: number;
  localSyncedRevision: number | null;
  localUpdatedAt: string;
  serverRevision: number;
  serverUpdatedAt: string;
  localPending: boolean;
}): boolean {
  if (!params.localPending) return true;
  const winner = resolveLww({
    clientLocalUpdatedAt: params.localUpdatedAt,
    serverUpdatedAt: params.serverUpdatedAt,
    clientRevision: params.localRevision,
    serverRevision: params.serverRevision,
  });
  return winner === 'server';
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function shouldSyncNow(params: {
  lastSuccessfulSyncAt: string | null;
  pendingCount: number;
  force?: boolean;
  reason?: 'manual' | 'reconnect' | 'foreground' | 'heartbeat' | 'workout_completed' | 'login';
  now?: number;
}): boolean {
  if (params.force) return true;
  if (params.reason === 'manual' || params.reason === 'login' || params.reason === 'workout_completed') {
    return true;
  }
  if (params.reason === 'reconnect' && params.pendingCount > 0) return true;

  const now = params.now ?? Date.now();
  if (!params.lastSuccessfulSyncAt) return true;

  const last = Date.parse(params.lastSuccessfulSyncAt);
  if (Number.isNaN(last)) return true;

  const elapsed = now - last;
  if (params.reason === 'foreground' && elapsed >= SIX_HOURS_MS) return true;
  if (elapsed >= ONE_DAY_MS) return true;
  if (params.pendingCount >= 50) return true;
  return false;
}
