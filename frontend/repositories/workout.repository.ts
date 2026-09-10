import * as queries from '@/db/queries';
import type { Workout, Exercise, SetData, WorkoutLocal, ExerciseLocal, SetLocal, Template } from '@/types';
import { newSyncDefaults } from '@/db/syncColumns';

export const WorkoutRepository = {
  insert: (w: WorkoutLocal) => queries.insertWorkout(w),
  update: (id: string, data: Partial<WorkoutLocal>, bumpRevision = true) =>
    queries.updateWorkout(id, data, bumpRevision),
  softDelete: (id: string) => queries.deleteWorkout(id),
  hardDelete: (id: string) => queries.hardDeleteWorkout(id),
  getActive: () => queries.getActiveWorkout(),
  getById: (id: string) => queries.getWorkoutById(id),
  getHistory: (limit = 100, offset = 0) => queries.getAllWorkouts(limit, offset),
  getCompletedUnsynced: () => queries.getCompletedUnsyncedWorkouts(),
  markSynced: (id: string, revision?: number) => queries.markWorkoutAsSynced(id, revision),
  countPending: () => queries.countPendingChanges(),

  insertExercise: (e: ExerciseLocal) => queries.insertExercise(e),
  updateExercise: (id: string, name: string, notes?: string | null) => queries.updateExercise(id, name, notes),
  deleteExercise: (id: string) => queries.deleteExercise(id),
  nextExerciseOrder: (workoutId: string) => queries.getNextExerciseOrderIndex(workoutId),

  insertSet: (s: SetLocal) => queries.insertSet(s),
  updateSet: (id: string, data: Partial<SetLocal>) => queries.updateSet(id, data),
  deleteSet: (id: string) => queries.deleteSet(id),
  nextSetOrder: (exerciseId: string) => queries.getNextSetOrderIndex(exerciseId),
  previousSets: (name: string, currentWorkoutId: string) => queries.getPreviousExerciseSets(name, currentWorkoutId),
  updateRestSeconds: (id: string, restSeconds: number) => queries.updateExerciseRestSeconds(id, restSeconds),
  recentExerciseNames: (limit?: number) => queries.getRecentExerciseNames(limit),

  createLocalWorkoutRow(partial: {
    id: string;
    status: string;
    started_at: string;
    ended_at?: string | null;
    name?: string | null;
    notes?: string | null;
    user_id?: string | null;
  }): WorkoutLocal {
    const sync = newSyncDefaults(partial.user_id ?? null);
    return {
      id: partial.id,
      status: partial.status,
      name: partial.name ?? null,
      notes: partial.notes ?? null,
      started_at: partial.started_at,
      ended_at: partial.ended_at ?? null,
      last_synced_at: null,
      ...sync,
    };
  },
};

export type { Workout, Exercise, SetData };
