import { getDatabase } from './database';
import type { WorkoutLocal, ExerciseLocal, SetLocal, Workout, Exercise, SetData } from '@/types';

export async function insertWorkout(w: WorkoutLocal): Promise<void> {
  const db = getDatabase();
  await db.runAsync(`INSERT INTO workouts_local (id, status, started_at, ended_at, last_synced_at) VALUES (?, ?, ?, ?, ?)`, [w.id, w.status, w.started_at, w.ended_at, w.last_synced_at]);
}
export async function updateWorkout(id: string, data: Partial<WorkoutLocal>): Promise<void> {
  const db = getDatabase();
  const fields: string[] = []; const values: (string | null)[] = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.ended_at !== undefined) { fields.push('ended_at = ?'); values.push(data.ended_at); }
  if (data.last_synced_at !== undefined) { fields.push('last_synced_at = ?'); values.push(data.last_synced_at); }
  if (fields.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE workouts_local SET ${fields.join(', ')} WHERE id = ?`, values);
}
export async function deleteWorkout(id: string): Promise<void> { await getDatabase().runAsync('DELETE FROM workouts_local WHERE id = ?', [id]); }
export async function getActiveWorkout(): Promise<Workout | null> {
  const row = await getDatabase().getFirstAsync<WorkoutLocal>(`SELECT * FROM workouts_local WHERE status = 'active' LIMIT 1`);
  return row ? buildFullWorkout(row) : null;
}
export async function getCompletedUnsyncedWorkouts(): Promise<Workout[]> {
  const rows = await getDatabase().getAllAsync<WorkoutLocal>(`SELECT * FROM workouts_local WHERE status = 'completed' AND last_synced_at IS NULL`);
  return Promise.all(rows.map(buildFullWorkout));
}
export async function getAllWorkouts(): Promise<Workout[]> {
  const rows = await getDatabase().getAllAsync<WorkoutLocal>(`SELECT * FROM workouts_local WHERE status != 'active' ORDER BY started_at DESC`);
  return Promise.all(rows.map(buildFullWorkout));
}
export async function markWorkoutAsSynced(id: string): Promise<void> {
  await getDatabase().runAsync(`UPDATE workouts_local SET status = 'synced', last_synced_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
}
export async function insertExercise(e: ExerciseLocal): Promise<void> {
  await getDatabase().runAsync(`INSERT INTO exercises_local (id, workout_id, name, order_index) VALUES (?, ?, ?, ?)`, [e.id, e.workout_id, e.name, e.order_index]);
}
export async function deleteExercise(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync('DELETE FROM sets_local WHERE exercise_id = ?', [id]);
  await db.runAsync('DELETE FROM exercises_local WHERE id = ?', [id]);
}
export async function getNextExerciseOrderIndex(workoutId: string): Promise<number> {
  const r = await getDatabase().getFirstAsync<{ maxIndex: number | null }>('SELECT MAX(order_index) as maxIndex FROM exercises_local WHERE workout_id = ?', [workoutId]);
  return (r?.maxIndex ?? -1) + 1;
}
export async function insertSet(s: SetLocal): Promise<void> {
  await getDatabase().runAsync(`INSERT INTO sets_local (id, exercise_id, weight, reps, rpe, is_warmup) VALUES (?, ?, ?, ?, ?, ?)`, [s.id, s.exercise_id, s.weight, s.reps, s.rpe, s.is_warmup]);
}
export async function updateSet(id: string, data: Partial<SetLocal>): Promise<void> {
  const db = getDatabase();
  const fields: string[] = []; const values: (number | null)[] = [];
  if (data.weight !== undefined) { fields.push('weight = ?'); values.push(data.weight); }
  if (data.reps !== undefined) { fields.push('reps = ?'); values.push(data.reps); }
  if (data.rpe !== undefined) { fields.push('rpe = ?'); values.push(data.rpe); }
  if (data.is_warmup !== undefined) { fields.push('is_warmup = ?'); values.push(data.is_warmup); }
  if (fields.length === 0) return;
  values.push(id as unknown as number);
  await db.runAsync(`UPDATE sets_local SET ${fields.join(', ')} WHERE id = ?`, values as (number | null)[]);
}
export async function deleteSet(id: string): Promise<void> { await getDatabase().runAsync('DELETE FROM sets_local WHERE id = ?', [id]); }
async function getSetsForExercise(exerciseId: string): Promise<SetData[]> {
  const rows = await getDatabase().getAllAsync<SetLocal>('SELECT * FROM sets_local WHERE exercise_id = ?', [exerciseId]);
  return rows.map(r => ({ id: r.id, exerciseId: r.exercise_id, weight: r.weight, reps: r.reps, rpe: r.rpe, isWarmup: r.is_warmup === 1 }));
}
async function getExercisesForWorkout(workoutId: string): Promise<Exercise[]> {
  const rows = await getDatabase().getAllAsync<ExerciseLocal>('SELECT * FROM exercises_local WHERE workout_id = ? ORDER BY order_index', [workoutId]);
  return Promise.all(rows.map(async r => ({ id: r.id, workoutId: r.workout_id, name: r.name, orderIndex: r.order_index, sets: await getSetsForExercise(r.id) })));
}
async function buildFullWorkout(row: WorkoutLocal): Promise<Workout> {
  return { id: row.id, status: row.status as 'active' | 'completed' | 'synced', startedAt: row.started_at, endedAt: row.ended_at, lastSyncedAt: row.last_synced_at, exercises: await getExercisesForWorkout(row.id) };
}
