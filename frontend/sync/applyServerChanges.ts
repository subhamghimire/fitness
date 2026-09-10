import { getDatabase } from '@/db/database';
import { newSyncDefaults } from '@/db/syncColumns';
import { shouldApplyServerChange } from '@/sync/conflict';
import type { SyncBatchChanges, SyncChangeItem } from '@/types';

async function getLocalRow(
  table: string,
  id: string
): Promise<{
  revision: number;
  last_synced_revision: number | null;
  local_updated_at: string;
  sync_status: string;
} | null> {
  return getDatabase().getFirstAsync(
    `SELECT revision, last_synced_revision, local_updated_at, sync_status FROM ${table} WHERE id = ?`,
    [id]
  );
}

async function applyOne(
  table: string,
  item: SyncChangeItem,
  upsert: (payload: Record<string, unknown>, serverUpdatedAt: string) => Promise<void>
): Promise<void> {
  const local = await getLocalRow(table, item.id);
  const serverUpdatedAt = (item.payload?.serverUpdatedAt as string) || item.localUpdatedAt;

  if (local) {
    const pending =
      local.sync_status === 'pending' ||
      local.sync_status === 'conflict' ||
      local.last_synced_revision == null ||
      local.revision > (local.last_synced_revision ?? 0);
    const apply = shouldApplyServerChange({
      localRevision: local.revision,
      localSyncedRevision: local.last_synced_revision,
      localUpdatedAt: local.local_updated_at,
      serverRevision: item.revision,
      serverUpdatedAt,
      localPending: pending,
    });
    if (!apply) return;
  }

  if (item.op === 'delete') {
    await getDatabase().runAsync(
      `UPDATE ${table} SET deleted_at = ?, sync_status = 'synced', last_synced_revision = ?, server_updated_at = ?, revision = ? WHERE id = ?`,
      [item.localUpdatedAt, item.revision, serverUpdatedAt, item.revision, item.id]
    );
    return;
  }

  if (!item.payload) return;
  await upsert(item.payload, serverUpdatedAt);
}

export async function applyServerChanges(changes: SyncBatchChanges): Promise<void> {
  const db = getDatabase();

  for (const item of changes.workouts || []) {
    await applyOne('workouts_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM workouts_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      if (existing) {
        await db.runAsync(
          `UPDATE workouts_local SET
            status = 'completed', name = ?, notes = ?, started_at = ?, ended_at = ?,
            updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?, last_synced_at = ?
           WHERE id = ?`,
          [
            (p.name as string) ?? null,
            (p.notes as string) ?? null,
            p.startedAt as string,
            (p.endedAt as string) ?? null,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            serverUpdatedAt,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO workouts_local (
            id, status, name, notes, started_at, ended_at, last_synced_at,
            user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            (p.name as string) ?? null,
            (p.notes as string) ?? null,
            p.startedAt as string,
            (p.endedAt as string) ?? null,
            serverUpdatedAt,
            sync.user_id,
            (p.startedAt as string) || sync.created_at,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }

  for (const item of changes.workoutExercises || []) {
    await applyOne('exercises_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM exercises_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      if (existing) {
        await db.runAsync(
          `UPDATE exercises_local SET
            workout_id = ?, name = ?, order_index = ?, notes = ?, rest_seconds = ?,
            updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?
           WHERE id = ?`,
          [
            p.workoutId as string,
            (p.name as string) || 'Exercise',
            (p.orderIndex as number) ?? 0,
            (p.notes as string) ?? null,
            (p.restSeconds as number) ?? null,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO exercises_local (
            id, workout_id, name, order_index, notes, rest_seconds,
            user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            p.workoutId as string,
            (p.name as string) || 'Exercise',
            (p.orderIndex as number) ?? 0,
            (p.notes as string) ?? null,
            (p.restSeconds as number) ?? null,
            sync.user_id,
            sync.created_at,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }

  for (const item of changes.sets || []) {
    await applyOne('sets_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM sets_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      const flags = [
        p.isWarmup ? 1 : 0,
        p.isDropset ? 1 : 0,
        p.isFailure ? 1 : 0,
      ];
      if (existing) {
        await db.runAsync(
          `UPDATE sets_local SET
            exercise_id = ?, order_index = ?, weight = ?, reps = ?,
            is_warmup = ?, is_dropset = ?, is_failure = ?,
            updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?
           WHERE id = ?`,
          [
            p.workoutExerciseId as string,
            (p.orderIndex as number) ?? 0,
            (p.weight as number) ?? null,
            (p.reps as number) ?? null,
            ...flags,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO sets_local (
            id, exercise_id, order_index, weight, reps, is_warmup, is_dropset, is_failure, is_completed,
            user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            p.workoutExerciseId as string,
            (p.orderIndex as number) ?? 0,
            (p.weight as number) ?? null,
            (p.reps as number) ?? null,
            ...flags,
            sync.user_id,
            sync.created_at,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }

  for (const item of changes.templates || []) {
    await applyOne('templates_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM templates_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      if (existing) {
        await db.runAsync(
          `UPDATE templates_local SET
            name = ?, updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?
           WHERE id = ?`,
          [
            (p.name as string) || 'Template',
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO templates_local (
            id, name, created_at, user_id, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            (p.name as string) || 'Template',
            (p.createdAt as string) || sync.created_at,
            sync.user_id,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }

  for (const item of changes.templateExercises || []) {
    await applyOne('template_exercises_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM template_exercises_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      if (existing) {
        await db.runAsync(
          `UPDATE template_exercises_local SET
            template_id = ?, name = ?, order_index = ?,
            updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?
           WHERE id = ?`,
          [
            p.templateId as string,
            (p.name as string) || 'Exercise',
            (p.orderIndex as number) ?? 0,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO template_exercises_local (
            id, template_id, name, order_index,
            user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            p.templateId as string,
            (p.name as string) || 'Exercise',
            (p.orderIndex as number) ?? 0,
            sync.user_id,
            sync.created_at,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }

  for (const item of changes.templateSets || []) {
    await applyOne('template_sets_local', item, async (p, serverUpdatedAt) => {
      const existing = await db.getFirstAsync(`SELECT id FROM template_sets_local WHERE id = ?`, [item.id]);
      const sync = newSyncDefaults();
      const flags = [p.isWarmup ? 1 : 0, p.isDropset ? 1 : 0, p.isFailure ? 1 : 0];
      if (existing) {
        await db.runAsync(
          `UPDATE template_sets_local SET
            template_exercise_id = ?, order_index = ?, weight = ?, reps = ?,
            is_warmup = ?, is_dropset = ?, is_failure = ?,
            updated_at = ?, local_updated_at = ?, server_updated_at = ?, deleted_at = NULL,
            sync_status = 'synced', revision = ?, last_synced_revision = ?
           WHERE id = ?`,
          [
            p.templateExerciseId as string,
            (p.orderIndex as number) ?? 0,
            (p.weight as number) ?? null,
            (p.reps as number) ?? null,
            ...flags,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
            item.id,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO template_sets_local (
            id, template_exercise_id, order_index, weight, reps, is_warmup, is_dropset, is_failure,
            user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
            sync_status, revision, last_synced_revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'synced', ?, ?)`,
          [
            item.id,
            p.templateExerciseId as string,
            (p.orderIndex as number) ?? 0,
            (p.weight as number) ?? null,
            (p.reps as number) ?? null,
            ...flags,
            sync.user_id,
            sync.created_at,
            serverUpdatedAt,
            serverUpdatedAt,
            serverUpdatedAt,
            item.revision,
            item.revision,
          ]
        );
      }
    });
  }
}
