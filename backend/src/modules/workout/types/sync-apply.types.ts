/**
 * Shared contract between the Sync orchestrator (SyncModule) and the fitness
 * domain services (WorkoutModule) for applying offline-first changes.
 *
 * The domain services own the business rules (ownership, conflict resolution,
 * tombstone semantics); SyncModule only coordinates the transaction and the
 * wire protocol. These types are structurally compatible with the sync DTOs so
 * no per-field mapping is required.
 */

export type ApplyOperation = "upsert" | "delete";

export interface WorkoutSyncChangeItem {
  op: ApplyOperation;
  id: string;
  revision: number;
  /** Logical time of the client mutation – used for conflict resolution. */
  clientUpdatedAt: string;
  payload?: Record<string, unknown> | null;
}

export interface SyncApplyAccepted {
  entityType: string;
  id: string;
  revision: number;
}

export interface SyncApplyRejected {
  entityType: string;
  id: string;
  reason: string;
  serverRevision?: number;
}

export interface SyncApplyConflict {
  entityType: string;
  id: string;
  clientRevision: number;
  serverRevision: number;
  resolvedWith: "server" | "client" | "merged";
  winningPayload?: Record<string, unknown>;
}

export type SyncOperation = "create" | "update" | "delete";
