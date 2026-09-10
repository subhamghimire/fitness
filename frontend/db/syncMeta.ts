import { getDatabase } from './database';
import { generateId } from '@/utils/uuid';
import type { SyncMeta } from '@/types';

const META_KEY = 'default';

export async function getSyncMeta(): Promise<SyncMeta> {
  const row = await getDatabase().getFirstAsync<{
    key: string;
    last_sync_token: string | null;
    last_successful_sync_at: string | null;
    last_attempted_sync_at: string | null;
    last_error: string | null;
    client_id: string | null;
  }>(`SELECT * FROM sync_meta WHERE key = ?`, [META_KEY]);

  if (!row) {
    const clientId = generateId();
    await getDatabase().runAsync(
      `INSERT INTO sync_meta (key, last_sync_token, last_successful_sync_at, last_attempted_sync_at, last_error, client_id)
       VALUES (?, NULL, NULL, NULL, NULL, ?)`,
      [META_KEY, clientId]
    );
    return {
      key: META_KEY,
      lastSyncToken: null,
      lastSuccessfulSyncAt: null,
      lastAttemptedSyncAt: null,
      lastError: null,
      clientId,
    };
  }

  return {
    key: row.key,
    lastSyncToken: row.last_sync_token,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastAttemptedSyncAt: row.last_attempted_sync_at,
    lastError: row.last_error,
    clientId: row.client_id,
  };
}

export async function updateSyncMeta(patch: Partial<{
  lastSyncToken: string | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastError: string | null;
  clientId: string | null;
}>): Promise<void> {
  await getSyncMeta();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (patch.lastSyncToken !== undefined) {
    fields.push('last_sync_token = ?');
    values.push(patch.lastSyncToken);
  }
  if (patch.lastSuccessfulSyncAt !== undefined) {
    fields.push('last_successful_sync_at = ?');
    values.push(patch.lastSuccessfulSyncAt);
  }
  if (patch.lastAttemptedSyncAt !== undefined) {
    fields.push('last_attempted_sync_at = ?');
    values.push(patch.lastAttemptedSyncAt);
  }
  if (patch.lastError !== undefined) {
    fields.push('last_error = ?');
    values.push(patch.lastError);
  }
  if (patch.clientId !== undefined) {
    fields.push('client_id = ?');
    values.push(patch.clientId);
  }
  if (fields.length === 0) return;
  values.push(META_KEY);
  await getDatabase().runAsync(`UPDATE sync_meta SET ${fields.join(', ')} WHERE key = ?`, values);
}
