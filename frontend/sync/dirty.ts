import { getDatabase } from '@/db/database';
import { isDirtyRow } from '@/db/syncColumns';
import type { SyncBatchChanges, SyncChangeItem, EntityOp } from '@/types';

const BATCH_LIMIT = 200;

type DirtyRow = {
  id: string;
  revision: number;
  local_updated_at: string;
  deleted_at: string | null;
  sync_status: string;
  last_synced_revision: number | null;
  [key: string]: unknown;
};

function toChange(row: DirtyRow, payload: Record<string, unknown> | null): SyncChangeItem {
  const op: EntityOp = row.deleted_at ? 'delete' : 'upsert';
  return {
    op,
    id: row.id,
    revision: row.revision,
    localUpdatedAt: row.local_updated_at,
    payload: op === 'delete' ? null : payload,
  };
}

export async function collectDirtyChanges(limit = BATCH_LIMIT): Promise<SyncBatchChanges> {
  const db = getDatabase();
  const changes: SyncBatchChanges = {
    workouts: [],
    workoutExercises: [],
    sets: [],
    templates: [],
    templateExercises: [],
    templateSets: [],
  };
  let remaining = limit;

  const workoutRows = await db.getAllAsync<DirtyRow>(
    `SELECT * FROM workouts_local
     WHERE status = 'completed'
       AND (sync_status IN ('pending','conflict') OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0))
     ORDER BY local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of workoutRows) {
    if (!isDirtyRow(row)) continue;
    changes.workouts.push(
      toChange(row, {
        id: row.id,
        name: row.name ?? null,
        notes: row.notes ?? null,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? null,
        status: row.status,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }
  remaining -= changes.workouts.length;
  if (remaining <= 0) return changes;

  const exerciseRows = await db.getAllAsync<DirtyRow>(
    `SELECT e.* FROM exercises_local e
     JOIN workouts_local w ON w.id = e.workout_id
     WHERE w.status = 'completed'
       AND (e.sync_status IN ('pending','conflict') OR e.last_synced_revision IS NULL OR e.revision > COALESCE(e.last_synced_revision, 0))
     ORDER BY e.local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of exerciseRows) {
    changes.workoutExercises.push(
      toChange(row, {
        id: row.id,
        workoutId: row.workout_id,
        name: row.name,
        orderIndex: row.order_index,
        notes: row.notes ?? null,
        restSeconds: row.rest_seconds ?? null,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }
  remaining -= changes.workoutExercises.length;
  if (remaining <= 0) return changes;

  const setRows = await db.getAllAsync<DirtyRow>(
    `SELECT s.* FROM sets_local s
     JOIN exercises_local e ON e.id = s.exercise_id
     JOIN workouts_local w ON w.id = e.workout_id
     WHERE w.status = 'completed'
       AND (s.sync_status IN ('pending','conflict') OR s.last_synced_revision IS NULL OR s.revision > COALESCE(s.last_synced_revision, 0))
     ORDER BY s.local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of setRows) {
    changes.sets.push(
      toChange(row, {
        id: row.id,
        workoutExerciseId: row.exercise_id,
        orderIndex: row.order_index ?? 0,
        weight: row.weight ?? null,
        reps: row.reps ?? null,
        isWarmup: row.is_warmup === 1,
        isDropset: row.is_dropset === 1,
        isFailure: row.is_failure === 1,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }
  remaining -= changes.sets.length;
  if (remaining <= 0) return changes;

  const templateRows = await db.getAllAsync<DirtyRow>(
    `SELECT * FROM templates_local
     WHERE sync_status IN ('pending','conflict') OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0)
     ORDER BY local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of templateRows) {
    changes.templates.push(
      toChange(row, {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }
  remaining -= changes.templates.length;
  if (remaining <= 0) return changes;

  const teRows = await db.getAllAsync<DirtyRow>(
    `SELECT * FROM template_exercises_local
     WHERE sync_status IN ('pending','conflict') OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0)
     ORDER BY local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of teRows) {
    changes.templateExercises.push(
      toChange(row, {
        id: row.id,
        templateId: row.template_id,
        name: row.name,
        orderIndex: row.order_index,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }
  remaining -= changes.templateExercises.length;
  if (remaining <= 0) return changes;

  const tsRows = await db.getAllAsync<DirtyRow>(
    `SELECT * FROM template_sets_local
     WHERE sync_status IN ('pending','conflict') OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0)
     ORDER BY local_updated_at ASC
     LIMIT ?`,
    [remaining]
  );
  for (const row of tsRows) {
    changes.templateSets.push(
      toChange(row, {
        id: row.id,
        templateExerciseId: row.template_exercise_id,
        orderIndex: row.order_index ?? 0,
        weight: row.weight ?? null,
        reps: row.reps ?? null,
        isWarmup: row.is_warmup === 1,
        isDropset: row.is_dropset === 1,
        isFailure: row.is_failure === 1,
        revision: row.revision,
        localUpdatedAt: row.local_updated_at,
        deletedAt: row.deleted_at,
      })
    );
  }

  return changes;
}

export function hasAnyChanges(changes: SyncBatchChanges): boolean {
  return (
    changes.workouts.length +
      changes.workoutExercises.length +
      changes.sets.length +
      changes.templates.length +
      changes.templateExercises.length +
      changes.templateSets.length >
    0
  );
}

export async function markEntitiesAccepted(
  accepted: { entityType: string; id: string; revision: number }[],
  serverTime: string
): Promise<void> {
  const db = getDatabase();
  const tableByType: Record<string, string> = {
    workout: 'workouts_local',
    workoutExercise: 'exercises_local',
    set: 'sets_local',
    template: 'templates_local',
    templateExercise: 'template_exercises_local',
    templateSet: 'template_sets_local',
  };

  for (const item of accepted) {
    const table = tableByType[item.entityType];
    if (!table) continue;
    await db.runAsync(
      `UPDATE ${table} SET sync_status = 'synced', last_synced_revision = ?, server_updated_at = ? WHERE id = ?`,
      [item.revision, serverTime, item.id]
    );
    if (table === 'workouts_local') {
      await db.runAsync(`UPDATE workouts_local SET last_synced_at = ? WHERE id = ?`, [serverTime, item.id]);
    }
  }
}
