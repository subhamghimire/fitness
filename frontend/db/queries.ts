import { getDatabase } from './database';
import { newSyncDefaults, touchPending } from './syncColumns';
import type {
  WorkoutLocal,
  ExerciseLocal,
  SetLocal,
  Workout,
  Exercise,
  SetData,
  SyncStatus,
  WorkoutLifecycleStatus,
} from '@/types';

function mapSyncStatus(v: string | null | undefined): SyncStatus {
  if (v === 'synced' || v === 'conflict') return v;
  return 'pending';
}

function mapLifecycle(status: string): WorkoutLifecycleStatus {
  return status === 'active' ? 'active' : 'completed';
}

export async function insertWorkout(w: WorkoutLocal): Promise<void> {
  const db = getDatabase();
  const sync = newSyncDefaults(w.user_id);
  await db.runAsync(
    `INSERT INTO workouts_local (
      id, status, name, notes, started_at, ended_at, last_synced_at,
      user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      w.id,
      w.status,
      w.name ?? null,
      w.notes ?? null,
      w.started_at,
      w.ended_at,
      w.last_synced_at,
      w.user_id ?? sync.user_id,
      w.created_at ?? sync.created_at,
      w.updated_at ?? sync.updated_at,
      w.local_updated_at ?? sync.local_updated_at,
      w.server_updated_at ?? sync.server_updated_at,
      w.deleted_at ?? sync.deleted_at,
      w.sync_status ?? sync.sync_status,
      w.revision ?? sync.revision,
      w.last_synced_revision ?? sync.last_synced_revision,
    ]
  );
}

export async function updateWorkout(id: string, data: Partial<WorkoutLocal>, bumpRevision = true): Promise<void> {
  const db = getDatabase();
  const current = await db.getFirstAsync<{ revision: number }>(
    `SELECT revision FROM workouts_local WHERE id = ?`,
    [id]
  );
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.status !== undefined) {
    fields.push('status = ?');
    values.push(data.status);
  }
  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.notes !== undefined) {
    fields.push('notes = ?');
    values.push(data.notes);
  }
  if (data.ended_at !== undefined) {
    fields.push('ended_at = ?');
    values.push(data.ended_at);
  }
  if (data.last_synced_at !== undefined) {
    fields.push('last_synced_at = ?');
    values.push(data.last_synced_at);
  }
  if (data.deleted_at !== undefined) {
    fields.push('deleted_at = ?');
    values.push(data.deleted_at);
  }
  if (data.sync_status !== undefined) {
    fields.push('sync_status = ?');
    values.push(data.sync_status);
  }
  if (data.server_updated_at !== undefined) {
    fields.push('server_updated_at = ?');
    values.push(data.server_updated_at);
  }
  if (data.last_synced_revision !== undefined) {
    fields.push('last_synced_revision = ?');
    values.push(data.last_synced_revision);
  }
  if (data.revision !== undefined && !bumpRevision) {
    fields.push('revision = ?');
    values.push(data.revision);
  }
  if (data.local_updated_at !== undefined && !bumpRevision) {
    fields.push('local_updated_at = ?');
    values.push(data.local_updated_at);
  }
  if (data.updated_at !== undefined && !bumpRevision) {
    fields.push('updated_at = ?');
    values.push(data.updated_at);
  }

  if (bumpRevision) {
    const touch = touchPending(current?.revision ?? 0);
    fields.push('updated_at = ?', 'local_updated_at = ?', 'sync_status = ?', 'revision = ?');
    values.push(touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision);
  }

  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE workouts_local SET ${fields.join(', ')} WHERE id = ?`, values);
}

/** Soft-delete workout and cascade soft-delete children. */
export async function deleteWorkout(id: string): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const workout = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM workouts_local WHERE id = ?`, [id]);
  if (!workout) return;
  const touch = touchPending(workout.revision);
  await db.runAsync(
    `UPDATE workouts_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
    [now, touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision, id]
  );

  const exercises = await db.getAllAsync<{ id: string; revision: number }>(
    `SELECT id, revision FROM exercises_local WHERE workout_id = ? AND deleted_at IS NULL`,
    [id]
  );
  for (const ex of exercises) {
    await softDeleteExercise(ex.id, now);
  }
}

/** Hard delete only for cancel of never-synced active workouts. */
export async function hardDeleteWorkout(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM sets_local WHERE exercise_id IN (SELECT id FROM exercises_local WHERE workout_id = ?)', [id]);
  await db.runAsync('DELETE FROM exercises_local WHERE workout_id = ?', [id]);
  await db.runAsync('DELETE FROM workouts_local WHERE id = ?', [id]);
}

export async function getActiveWorkout(): Promise<Workout | null> {
  const row = await getDatabase().getFirstAsync<WorkoutLocal>(
    `SELECT * FROM workouts_local WHERE status = 'active' AND deleted_at IS NULL LIMIT 1`
  );
  return row ? buildFullWorkout(row) : null;
}

export async function getCompletedUnsyncedWorkouts(): Promise<Workout[]> {
  const rows = await getDatabase().getAllAsync<WorkoutLocal>(
    `SELECT * FROM workouts_local
     WHERE status = 'completed'
       AND deleted_at IS NULL
       AND (sync_status = 'pending' OR sync_status = 'conflict' OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0))`
  );
  return Promise.all(rows.map(buildFullWorkout));
}

export async function getWorkoutById(id: string): Promise<Workout | null> {
  const row = await getDatabase().getFirstAsync<WorkoutLocal>(
    `SELECT * FROM workouts_local WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return row ? buildFullWorkout(row) : null;
}

export async function getAllWorkouts(limit = 100, offset = 0): Promise<Workout[]> {
  const rows = await getDatabase().getAllAsync<WorkoutLocal>(
    `SELECT * FROM workouts_local
     WHERE status != 'active' AND deleted_at IS NULL
     ORDER BY started_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return Promise.all(rows.map(buildFullWorkout));
}

export async function markWorkoutAsSynced(id: string, revision?: number): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM workouts_local WHERE id = ?`, [id]);
  const rev = revision ?? row?.revision ?? 1;
  await db.runAsync(
    `UPDATE workouts_local SET sync_status = 'synced', last_synced_at = ?, last_synced_revision = ? WHERE id = ?`,
    [new Date().toISOString(), rev, id]
  );
}

export async function insertExercise(e: ExerciseLocal): Promise<void> {
  const sync = newSyncDefaults(e.user_id);
  await getDatabase().runAsync(
    `INSERT INTO exercises_local (
      id, workout_id, name, order_index, notes, rest_seconds,
      user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.workout_id,
      e.name,
      e.order_index,
      e.notes ?? null,
      e.rest_seconds ?? null,
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

export async function updateExercise(id: string, name: string, notes?: string | null): Promise<void> {
  const db = getDatabase();
  const current = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM exercises_local WHERE id = ?`, [id]);
  const touch = touchPending(current?.revision ?? 0);
  await db.runAsync(
    `UPDATE exercises_local SET name = ?, notes = COALESCE(?, notes), updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
    [name, notes ?? null, touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision, id]
  );
}

async function softDeleteExercise(id: string, deletedAt: string): Promise<void> {
  const db = getDatabase();
  const current = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM exercises_local WHERE id = ?`, [id]);
  if (!current) return;
  const touch = touchPending(current.revision);
  await db.runAsync(
    `UPDATE exercises_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
    [deletedAt, touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision, id]
  );
  const sets = await db.getAllAsync<{ id: string; revision: number }>(
    `SELECT id, revision FROM sets_local WHERE exercise_id = ? AND deleted_at IS NULL`,
    [id]
  );
  for (const s of sets) {
    await softDeleteSet(s.id, deletedAt);
  }
}

export async function deleteExercise(id: string): Promise<void> {
  await softDeleteExercise(id, new Date().toISOString());
}

export async function getNextExerciseOrderIndex(workoutId: string): Promise<number> {
  const r = await getDatabase().getFirstAsync<{ maxIndex: number | null }>(
    'SELECT MAX(order_index) as maxIndex FROM exercises_local WHERE workout_id = ? AND deleted_at IS NULL',
    [workoutId]
  );
  return (r?.maxIndex ?? -1) + 1;
}

export async function insertSet(s: SetLocal): Promise<void> {
  const sync = newSyncDefaults(s.user_id);
  await getDatabase().runAsync(
    `INSERT INTO sets_local (
      id, exercise_id, order_index, weight, reps, is_warmup, is_dropset, is_failure, is_completed,
      user_id, created_at, updated_at, local_updated_at, server_updated_at, deleted_at,
      sync_status, revision, last_synced_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.exercise_id,
      s.order_index ?? 0,
      s.weight,
      s.reps,
      s.is_warmup,
      s.is_dropset,
      s.is_failure,
      s.is_completed,
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

export async function updateSet(id: string, data: Partial<SetLocal>): Promise<void> {
  const db = getDatabase();
  const current = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM sets_local WHERE id = ?`, [id]);
  const fields: string[] = [];
  const values: (number | string | null)[] = [];
  if (data.weight !== undefined) {
    fields.push('weight = ?');
    values.push(data.weight);
  }
  if (data.reps !== undefined) {
    fields.push('reps = ?');
    values.push(data.reps);
  }
  if (data.order_index !== undefined) {
    fields.push('order_index = ?');
    values.push(data.order_index);
  }
  if (data.is_warmup !== undefined) {
    fields.push('is_warmup = ?');
    values.push(data.is_warmup);
  }
  if (data.is_dropset !== undefined) {
    fields.push('is_dropset = ?');
    values.push(data.is_dropset);
  }
  if (data.is_failure !== undefined) {
    fields.push('is_failure = ?');
    values.push(data.is_failure);
  }
  if (data.is_completed !== undefined) {
    fields.push('is_completed = ?');
    values.push(data.is_completed);
  }
  const touch = touchPending(current?.revision ?? 0);
  fields.push('updated_at = ?', 'local_updated_at = ?', 'sync_status = ?', 'revision = ?');
  values.push(touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision);
  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE sets_local SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function softDeleteSet(id: string, deletedAt: string): Promise<void> {
  const db = getDatabase();
  const current = await db.getFirstAsync<{ revision: number }>(`SELECT revision FROM sets_local WHERE id = ?`, [id]);
  if (!current) return;
  const touch = touchPending(current.revision);
  await db.runAsync(
    `UPDATE sets_local SET deleted_at = ?, updated_at = ?, local_updated_at = ?, sync_status = ?, revision = ? WHERE id = ?`,
    [deletedAt, touch.updated_at, touch.local_updated_at, touch.sync_status, touch.revision, id]
  );
}

export async function deleteSet(id: string): Promise<void> {
  await softDeleteSet(id, new Date().toISOString());
}

export async function getNextSetOrderIndex(exerciseId: string): Promise<number> {
  const r = await getDatabase().getFirstAsync<{ maxIndex: number | null }>(
    'SELECT MAX(order_index) as maxIndex FROM sets_local WHERE exercise_id = ? AND deleted_at IS NULL',
    [exerciseId]
  );
  return (r?.maxIndex ?? -1) + 1;
}

async function getSetsForExercise(exerciseId: string): Promise<SetData[]> {
  const rows = await getDatabase().getAllAsync<SetLocal>(
    'SELECT * FROM sets_local WHERE exercise_id = ? AND deleted_at IS NULL ORDER BY order_index',
    [exerciseId]
  );
  return rows.map((r) => ({
    id: r.id,
    exerciseId: r.exercise_id,
    orderIndex: r.order_index ?? 0,
    weight: r.weight,
    reps: r.reps,
    isWarmup: r.is_warmup === 1,
    isDropset: r.is_dropset === 1,
    isFailure: r.is_failure === 1,
    isCompleted: r.is_completed === 1,
    syncStatus: mapSyncStatus(r.sync_status),
    revision: r.revision,
  }));
}

export async function getPreviousExerciseSets(name: string, currentWorkoutId: string): Promise<SetData[]> {
  const row = await getDatabase().getFirstAsync<{ id: string }>(
    `
    SELECT e.id FROM exercises_local e
    JOIN workouts_local w ON e.workout_id = w.id
    WHERE e.name = ? AND w.id != ? AND w.status = 'completed' AND w.deleted_at IS NULL AND e.deleted_at IS NULL
    ORDER BY w.started_at DESC LIMIT 1
  `,
    [name, currentWorkoutId]
  );
  if (!row) return [];
  return getSetsForExercise(row.id);
}

async function getExercisesForWorkout(workoutId: string): Promise<Exercise[]> {
  const rows = await getDatabase().getAllAsync<ExerciseLocal>(
    'SELECT * FROM exercises_local WHERE workout_id = ? AND deleted_at IS NULL ORDER BY order_index',
    [workoutId]
  );
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      workoutId: r.workout_id,
      name: r.name,
      orderIndex: r.order_index,
      notes: r.notes,
      restSeconds: r.rest_seconds,
      syncStatus: mapSyncStatus(r.sync_status),
      revision: r.revision,
      sets: await getSetsForExercise(r.id),
    }))
  );
}

async function buildFullWorkout(row: WorkoutLocal): Promise<Workout> {
  return {
    id: row.id,
    status: mapLifecycle(row.status),
    name: row.name,
    notes: row.notes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastSyncedAt: row.last_synced_at,
    syncStatus: mapSyncStatus(row.sync_status),
    revision: row.revision ?? 1,
    exercises: await getExercisesForWorkout(row.id),
  };
}

export async function countPendingChanges(): Promise<number> {
  const db = getDatabase();
  const dirty = `sync_status IN ('pending','conflict') OR last_synced_revision IS NULL OR revision > COALESCE(last_synced_revision, 0)`;
  const tables = [
    `workouts_local WHERE status = 'completed' AND (${dirty})`,
    `exercises_local WHERE (${dirty})`,
    `sets_local WHERE (${dirty})`,
    `templates_local WHERE (${dirty})`,
    `template_exercises_local WHERE (${dirty})`,
    `template_sets_local WHERE (${dirty})`,
  ];
  let total = 0;
  for (const clause of tables) {
    const r = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM ${clause}`);
    total += r?.c ?? 0;
  }
  return total;
}
