import { getCurrentISOString } from '@/utils/date';
import type { SyncStatus } from '@/types';

/** Shared sync-column defaults for local inserts. */
export function newSyncDefaults(userId: string | null = null): {
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: SyncStatus;
  revision: number;
  last_synced_revision: number | null;
} {
  const now = getCurrentISOString();
  return {
    user_id: userId,
    created_at: now,
    updated_at: now,
    local_updated_at: now,
    server_updated_at: null,
    deleted_at: null,
    sync_status: 'pending',
    revision: 1,
    last_synced_revision: null,
  };
}

export function touchPending(revision: number): {
  updated_at: string;
  local_updated_at: string;
  sync_status: SyncStatus;
  revision: number;
} {
  const now = getCurrentISOString();
  return {
    updated_at: now,
    local_updated_at: now,
    sync_status: 'pending',
    revision: revision + 1,
  };
}

export const SYNC_COLUMN_NAMES = [
  'user_id',
  'created_at',
  'updated_at',
  'local_updated_at',
  'server_updated_at',
  'deleted_at',
  'sync_status',
  'revision',
  'last_synced_revision',
] as const;

export function isDirtyRow(row: {
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}): boolean {
  if (row.sync_status === 'pending' || row.sync_status === 'conflict') return true;
  if (row.last_synced_revision == null) return true;
  return row.revision > row.last_synced_revision;
}
