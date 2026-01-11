import { create } from 'zustand';
import { generateId } from '@/utils/uuid';
import { getCurrentISOString } from '@/utils/date';
import { insertWorkout, updateWorkout, deleteWorkout, getActiveWorkout, insertExercise, deleteExercise, getNextExerciseOrderIndex, insertSet, updateSet as updateSetQuery, deleteSet as deleteSetQuery } from '@/db/queries';
import type { Workout, SetData, WorkoutLocal, ExerciseLocal, SetLocal } from '@/types';
interface WorkoutState { activeWorkout: Workout | null; isLoading: boolean; startWorkout: () => Promise<string>; endWorkout: () => Promise<void>; cancelWorkout: () => Promise<void>; loadActiveWorkout: () => Promise<void>; addExercise: (name: string) => Promise<string>; removeExercise: (exerciseId: string) => Promise<void>; addSet: (exerciseId: string) => Promise<string>; updateSet: (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => Promise<void>; removeSet: (setId: string) => Promise<void>; toggleWarmup: (setId: string) => Promise<void>; }
export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  activeWorkout: null, isLoading: false,
  loadActiveWorkout: async () => { set({ isLoading: true }); const w = await getActiveWorkout(); set({ activeWorkout: w, isLoading: false }); },
  startWorkout: async () => {
    const id = generateId(); const now = getCurrentISOString();
    await insertWorkout({ id, status: 'active', started_at: now, ended_at: null, last_synced_at: null });
    set({ activeWorkout: { id, status: 'active', startedAt: now, endedAt: null, lastSyncedAt: null, exercises: [] } });
    return id;
  },
  endWorkout: async () => { const { activeWorkout: w } = get(); if (!w) return; await updateWorkout(w.id, { status: 'completed', ended_at: getCurrentISOString() }); set({ activeWorkout: null }); },
  cancelWorkout: async () => { const { activeWorkout: w } = get(); if (!w) return; await deleteWorkout(w.id); set({ activeWorkout: null }); },
  addExercise: async (name) => {
    const { activeWorkout: w } = get(); if (!w) throw new Error('No active workout');
    const id = generateId(); const orderIndex = await getNextExerciseOrderIndex(w.id);
    await insertExercise({ id, workout_id: w.id, name, order_index: orderIndex });
    set({ activeWorkout: { ...w, exercises: [...w.exercises, { id, workoutId: w.id, name, orderIndex, sets: [] }] } });
    return id;
  },
  removeExercise: async (exerciseId) => { const { activeWorkout: w } = get(); if (!w) return; await deleteExercise(exerciseId); set({ activeWorkout: { ...w, exercises: w.exercises.filter(e => e.id !== exerciseId) } }); },
  addSet: async (exerciseId) => {
    const { activeWorkout: w } = get(); if (!w) throw new Error('No active workout');
    const ex = w.exercises.find(e => e.id === exerciseId); if (!ex) throw new Error('Exercise not found');
    const id = generateId(); const last = ex.sets[ex.sets.length - 1];
    await insertSet({ id, exercise_id: exerciseId, weight: last?.weight ?? null, reps: last?.reps ?? null, rpe: null, is_warmup: 0 });
    const newSet: SetData = { id, exerciseId, weight: last?.weight ?? null, reps: last?.reps ?? null, rpe: null, isWarmup: false };
    set({ activeWorkout: { ...w, exercises: w.exercises.map(e => e.id === exerciseId ? { ...e, sets: [...e.sets, newSet] } : e) } });
    return id;
  },
  updateSet: async (setId, data) => {
    const { activeWorkout: w } = get(); if (!w) return;
    const localData: Partial<SetLocal> = {};
    if (data.weight !== undefined) localData.weight = data.weight;
    if (data.reps !== undefined) localData.reps = data.reps;
    if (data.rpe !== undefined) localData.rpe = data.rpe;
    if (data.isWarmup !== undefined) localData.is_warmup = data.isWarmup ? 1 : 0;
    await updateSetQuery(setId, localData);
    set({ activeWorkout: { ...w, exercises: w.exercises.map(ex => ({ ...ex, sets: ex.sets.map(s => s.id === setId ? { ...s, ...data } : s) })) } });
  },
  removeSet: async (setId) => { const { activeWorkout: w } = get(); if (!w) return; await deleteSetQuery(setId); set({ activeWorkout: { ...w, exercises: w.exercises.map(ex => ({ ...ex, sets: ex.sets.filter(s => s.id !== setId) })) } }); },
  toggleWarmup: async (setId) => {
    const { activeWorkout: w } = get(); if (!w) return;
    let isWarmup = false;
    for (const ex of w.exercises) { const s = ex.sets.find(s => s.id === setId); if (s) { isWarmup = s.isWarmup; break; } }
    await get().updateSet(setId, { isWarmup: !isWarmup });
  },
}));
