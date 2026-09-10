import { getDatabase } from './database';
import { newSyncDefaults, touchPending } from './syncColumns';
import type {
  Template,
  TemplateLocal,
  TemplateExerciseLocal,
  TemplateSetLocal,
  SyncStatus,
} from '@/types';

function mapSyncStatus(v: string | null | undefined): SyncStatus {
  if (v === 'synced' || v === 'conflict') return v;
  return 'pending';
}

export async function insertTemplate(t: TemplateLocal): Promise<void> {
  const sync = newSyncDefaults(t.user_id);
  await getDatabase().runAsync(
    `INSERT INTO templates_local (
      id, name, created_at,
      user_id, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.id,
      t.name,
      t.created_at,
      t.user_id ?? sync.user_id,
      t.updated_at ?? sync.updated_at,
      t.local_updated_at ?? sync.local_updated_at,
      t.server_updated_at ?? sync.server_updated_at,
      t.deleted_at ?? sync.deleted_at,
      t.sync_status ?? sync.sync_status,
      t.revision ?? sync.revision,
      t.last_synced_revision ?? sync.last_synced_revision,
    ]
  );
}

export async function insertTemplateExercise(e: TemplateExerciseLocal): Promise<void> {
  const sync = newSyncDefaults(e.user_id);
  await getDatabase().runAsync(
    `INSERT INTO template_exercises_local (
      id, template_id, name, order_index,
      user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.template_id,
      e.name,
      e.order_index,
      e.user_id ?? sync.user_id,
      e.created_at ?? sync.created_at,
      e.updated_at ?? sync.updated_at,
      e.local_updated_at ?? sync.local_updated_at,
      e.server_updated_at ?? sync.server_updated_at,
      e.deleted_at ?? sync.deleted_at,
      e.sync_status ?? sync.sync_status,
      e.revision ?? sync.revision,
      e.last_synced_revision ?? sync.last_synced_revision,
    ]
  );
}

export async function insertTemplateSet(s: TemplateSetLocal): Promise<void> {
  const sync = newSyncDefaults(s.user_id);
  await getDatabase().runAsync(
    `INSERT INTO template_sets_local (
      id, template_exercise_id, order_index, weight, reps, is_warmup, is_dropset, is_failure,
      user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.template_exercise_id,
      s.order_index ?? 0,
      s.weight,
      s.reps,
      s.is_warmup,
      s.is_dropset,
      s.is_failure,
      s.user_id ?? sync.user_id,
      s.created_at ?? sync.created_at,
      s.updated_at ?? sync.updated_at,
      s.local_updated_at ?? sync.local_updated_at,
      s.server_updated_at ?? sync.server_updated_at,
      s.deleted_at ?? sync.deleted_at,
      s.sync_status ?? sync.sync_status,
      s.revision ?? sync.revision,
      s.last_synced_revision ?? sync.last_synced_revision,
    ]
  );
}

export async function getAllTemplates(): Promise<Template[]> {
  const rows = await getDatabase().getAllAsync<TemplateLocal>(
    `SELECT * FROM templates_local WHERE deleted_at IS NULL ORDER BY created_at DESC`
  );
  return Promise.all(
    rows.map(async (r) => {
      const exRows = await getDatabase().getAllAsync<TemplateExerciseLocal>(
        'SELECT * FROM template_exercises_local WHERE template_id = ? AND deleted_at IS NULL ORDER BY order_index',
        [r.id]
      );
      const exercises = await Promise.all(
        exRows.map(async (ex) => {
          const setRows = await getDatabase().getAllAsync<TemplateSetLocal>(
            'SELECT * FROM template_sets_local WHERE template_exercise_id = ? AND deleted_at IS NULL ORDER BY order_index',
            [ex.id]
          );
          return {
            id: ex.id,
            templateId: ex.template_id,
            name: ex.name,
            orderIndex: ex.order_index,
            sets: setRows.map((s) => ({
              id: s.id,
              templateExerciseId: s.template_exercise_id,
              orderIndex: s.order_index ?? 0,
              weight: s.weight,
              reps: s.reps,
              isWarmup: s.is_warmup === 1,
              isDropset: s.is_dropset === 1,
              isFailure: s.is_failure === 1,
            })),
          };
        })
      );
      return {
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        syncStatus: mapSyncStatus(r.sync_status),
        exercises,
      };
    })
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const current = await db.getFirstAsync<{ revision: number }>(
    `SELECT revision FROM templates_local WHERE id = ?`,
    [id]
  );
  if (!current) return;
  const touch = touchPending(current.revision);
  await db.runAsync(
    `UPDATE templates_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
    [now, touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision, id]
  );

  const exs = await db.getAllAsync<{ id: string; revision: number }>(
    'SELECT id, revision FROM template_exercises_local WHERE template_id = ? AND deleted_at IS NULL',
    [id]
  );
  for (const ex of exs) {
    const et = touchPending(ex.revision);
    await db.runAsync(
      `UPDATE template_exercises_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
      [now, et.updated_at, et.local_updated_at, et.sync_status, et.revision, ex.id]
    );
    const sets = await db.getAllAsync<{ id: string; revision: number }>(
      'SELECT id, revision FROM template_sets_local WHERE template_exercise_id = ? AND deleted_at IS NULL',
      [ex.id]
    );
    for (const s of sets) {
      const st = touchPending(s.revision);
      await db.runAsync(
        `UPDATE template_sets_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
        [now, st.updated_at, st.local_updated_at, st.sync_status, st.revision, s.id]
      );
    }
  }
}
