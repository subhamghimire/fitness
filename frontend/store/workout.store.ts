import { create } from 'zustand';
import { generateId } from '@/utils/uuid';
import { getCurrentISOString } from '@/utils/date';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { newSyncDefaults } from '@/db/syncColumns';
import { suggestedRestSeconds } from '@/utils/progression';
import type { Workout, SetData, SetLocal, Exercise, Template } from '@/types';

interface WorkoutState {
  activeWorkout: Workout | null;
  isLoading: boolean;
  previousSets: Record<string, SetData[]>;
  startWorkout: () => Promise<string>;
  startFromTemplate: (template: Template) => Promise<string>;
  endWorkout: () => Promise<void>;
  cancelWorkout: () => Promise<void>;
  clearSession: () => void;
  loadActiveWorkout: () => Promise<void>;
  loadPreviousSets: (exerciseId: string, name: string) => Promise<void>;
  addExercise: (name: string) => Promise<string>;
  updateExercise: (
    exerciseId: string,
    data: Partial<Pick<Exercise, 'name' | 'notes' | 'restSeconds'>>
  ) => Promise<void>;
  removeExercise: (exerciseId: string) => Promise<void>;
  addSet: (exerciseId: string) => Promise<string>;
  updateSet: (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => Promise<void>;
  removeSet: (setId: string) => Promise<void>;
  cycleSetType: (setId: string) => Promise<void>;
}

function emptyWorkout(id: string, now: string): Workout {
  return {
    id,
    status: 'active',
    startedAt: now,
    endedAt: null,
    lastSyncedAt: null,
    syncStatus: 'pending',
    revision: 1,
    exercises: [],
  };
}

async function resolveExistingActive(get: () => WorkoutState): Promise<Workout | null> {
  const inMemory = get().activeWorkout;
  if (inMemory) return inMemory;
  return WorkoutRepository.getActive();
}

export const useWorkoutStore = create<WorkoutState>((set, get) => ({
  activeWorkout: null,
  isLoading: false,
  previousSets: {},

  clearSession: () => {
    set({ activeWorkout: null, previousSets: {}, isLoading: false });
  },

  loadActiveWorkout: async () => {
    const priorId = get().activeWorkout?.id;
    const priorPrevious = get().previousSets;
    set({ isLoading: true });
    try {
      const w = await WorkoutRepository.getActive();
      if (w && w.id === priorId) {
        // Keep previousSets to avoid PREV column flash on re-entry
        set({ activeWorkout: w, previousSets: priorPrevious, isLoading: false });
        w.exercises.forEach((ex) => {
          if (!priorPrevious[ex.id]) get().loadPreviousSets(ex.id, ex.name);
        });
        return;
      }
      set({ activeWorkout: w, previousSets: {} });
      if (w) {
        w.exercises.forEach((ex) => get().loadPreviousSets(ex.id, ex.name));
      }
    } catch {
      set({ activeWorkout: null, previousSets: {} });
    } finally {
      set({ isLoading: false });
    }
  },

  loadPreviousSets: async (exerciseId, name) => {
    const w = get().activeWorkout;
    if (!w) return;
    try {
      const sets = await WorkoutRepository.previousSets(name, w.id);
      set((state) => ({ previousSets: { ...state.previousSets, [exerciseId]: sets } }));
    } catch {
      // Keep empty PREV rather than crashing the workout screen
    }
  },

  startWorkout: async () => {
    const existing = await resolveExistingActive(get);
    if (existing) {
      set({ activeWorkout: existing });
      return existing.id;
    }
    const id = generateId();
    const now = getCurrentISOString();
    await WorkoutRepository.insert(
      WorkoutRepository.createLocalWorkoutRow({ id, status: 'active', started_at: now })
    );
    set({ activeWorkout: emptyWorkout(id, now), previousSets: {} });
    return id;
  },

  startFromTemplate: async (template) => {
    const existing = await resolveExistingActive(get);
    if (existing) {
      set({ activeWorkout: existing });
      return existing.id;
    }

    const id = generateId();
    const now = getCurrentISOString();
    await WorkoutRepository.insert(
      WorkoutRepository.createLocalWorkoutRow({ id, status: 'active', started_at: now })
    );

    const exercises: Exercise[] = [];
    let orderIndex = 0;
    for (const ex of template.exercises) {
      const exId = generateId();
      const sync = newSyncDefaults();
      const restSeconds = suggestedRestSeconds(ex.name);
      await WorkoutRepository.insertExercise({
        id: exId,
        workout_id: id,
        name: ex.name,
        order_index: orderIndex,
        notes: null,
        rest_seconds: restSeconds,
        ...sync,
      });

      const sets: SetData[] = [];
      let setOrder = 0;
      for (const s of ex.sets) {
        const setId = generateId();
        const setSync = newSyncDefaults();
        await WorkoutRepository.insertSet({
          id: setId,
          exercise_id: exId,
          order_index: setOrder,
          weight: s.weight,
          reps: s.reps,
          is_warmup: s.isWarmup ? 1 : 0,
          is_dropset: s.isDropset ? 1 : 0,
          is_failure: s.isFailure ? 1 : 0,
          is_completed: 0,
          ...setSync,
        });
        sets.push({
          id: setId,
          exerciseId: exId,
          orderIndex: setOrder,
          weight: s.weight,
          reps: s.reps,
          isWarmup: s.isWarmup,
          isDropset: s.isDropset,
          isFailure: s.isFailure,
          isCompleted: false,
        });
        setOrder++;
      }
      exercises.push({
        id: exId,
        workoutId: id,
        name: ex.name,
        orderIndex,
        notes: null,
        restSeconds,
        sets,
      });
      orderIndex++;
    }

    set({ activeWorkout: { ...emptyWorkout(id, now), exercises }, previousSets: {} });
    exercises.forEach((ex) => get().loadPreviousSets(ex.id, ex.name));
    return id;
  },

  endWorkout: async () => {
    const { activeWorkout: w } = get();
    if (!w) return;

    const endedAt = getCurrentISOString();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await WorkoutRepository.update(w.id, { status: 'completed', ended_at: endedAt });
        set({ activeWorkout: null, previousSets: {} });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to finish workout');
  },

  cancelWorkout: async () => {
    const { activeWorkout: w } = get();
    if (!w) return;
    await WorkoutRepository.hardDelete(w.id);
    set({ activeWorkout: null, previousSets: {} });
  },

  addExercise: async (name) => {
    const { activeWorkout: w } = get();
    if (!w) throw new Error('No active workout');
    const id = generateId();
    const orderIndex = await WorkoutRepository.nextExerciseOrder(w.id);
    const sync = newSyncDefaults();
    const restSeconds = suggestedRestSeconds(name);
    await WorkoutRepository.insertExercise({
      id,
      workout_id: w.id,
      name,
      order_index: orderIndex,
      notes: null,
      rest_seconds: restSeconds,
      ...sync,
    });
    set({
      activeWorkout: {
        ...w,
        exercises: [
          ...w.exercises,
          { id, workoutId: w.id, name, orderIndex, notes: null, restSeconds, sets: [] },
        ],
      },
    });
    get().loadPreviousSets(id, name);
    return id;
  },

  updateExercise: async (exerciseId, data) => {
    const { activeWorkout: w } = get();
    if (!w) return;
    const ex = w.exercises.find((e) => e.id === exerciseId);
    if (!ex) return;
    const nextName = data.name ?? ex.name;
    const nextNotes = data.notes !== undefined ? data.notes : ex.notes;
    const nextRest =
      data.restSeconds !== undefined ? data.restSeconds : ex.restSeconds ?? null;

    await WorkoutRepository.updateExercise(exerciseId, nextName, nextNotes);
    if (data.restSeconds !== undefined && data.restSeconds != null) {
      await WorkoutRepository.updateRestSeconds(exerciseId, data.restSeconds);
    }

    set({
      activeWorkout: {
        ...w,
        exercises: w.exercises.map((e) =>
          e.id === exerciseId
            ? { ...e, name: nextName, notes: nextNotes, restSeconds: nextRest }
            : e
        ),
      },
    });

    if (data.name && data.name !== ex.name) {
      get().loadPreviousSets(exerciseId, data.name);
    }
  },

  removeExercise: async (exerciseId) => {
    const { activeWorkout: w } = get();
    if (!w) return;
    await WorkoutRepository.deleteExercise(exerciseId);
    const { [exerciseId]: _removed, ...restPrev } = get().previousSets;
    set({
      activeWorkout: { ...w, exercises: w.exercises.filter((e) => e.id !== exerciseId) },
      previousSets: restPrev,
    });
  },

  addSet: async (exerciseId) => {
    const { activeWorkout: w } = get();
    if (!w) throw new Error('No active workout');
    const ex = w.exercises.find((e) => e.id === exerciseId);
    if (!ex) throw new Error('Exercise not found');
    const id = generateId();
    const last = ex.sets[ex.sets.length - 1];
    const orderIndex = last ? (last.orderIndex ?? ex.sets.length - 1) + 1 : 0;
    const newSet: SetData = {
      id,
      exerciseId,
      orderIndex,
      weight: last?.weight ?? null,
      reps: last?.reps ?? null,
      isWarmup: false,
      isDropset: false,
      isFailure: false,
      isCompleted: false,
    };
    set({
      activeWorkout: {
        ...w,
        exercises: w.exercises.map((e) =>
          e.id === exerciseId ? { ...e, sets: [...e.sets, newSet] } : e
        ),
      },
    });
    const sync = newSyncDefaults();
    try {
      await WorkoutRepository.insertSet({
        id,
        exercise_id: exerciseId,
        order_index: orderIndex,
        weight: last?.weight ?? null,
        reps: last?.reps ?? null,
        is_warmup: 0,
        is_dropset: 0,
        is_failure: 0,
        is_completed: 0,
        ...sync,
      });
    } catch (error) {
      const current = get().activeWorkout;
      if (current) {
        set({
          activeWorkout: {
            ...current,
            exercises: current.exercises.map((e) =>
              e.id === exerciseId ? { ...e, sets: e.sets.filter((s) => s.id !== id) } : e
            ),
          },
        });
      }
      throw error;
    }
    return id;
  },

  updateSet: async (setId, data) => {
    const { activeWorkout: w } = get();
    if (!w) return;
    // Optimistic UI first — only rewrite the exercise that owns this set
    set({
      activeWorkout: {
        ...w,
        exercises: w.exercises.map((ex) => {
          if (!ex.sets.some((s) => s.id === setId)) return ex;
          return {
            ...ex,
            sets: ex.sets.map((s) => (s.id === setId ? { ...s, ...data } : s)),
          };
        }),
      },
    });
    const localData: Partial<SetLocal> = {};
    if (data.weight !== undefined) localData.weight = data.weight;
    if (data.reps !== undefined) localData.reps = data.reps;
    if (data.orderIndex !== undefined) localData.order_index = data.orderIndex;
    if (data.isWarmup !== undefined) localData.is_warmup = data.isWarmup ? 1 : 0;
    if (data.isDropset !== undefined) localData.is_dropset = data.isDropset ? 1 : 0;
    if (data.isFailure !== undefined) localData.is_failure = data.isFailure ? 1 : 0;
    if (data.isCompleted !== undefined) localData.is_completed = data.isCompleted ? 1 : 0;
    try {
      await WorkoutRepository.updateSet(setId, localData);
    } catch {
      // Keep optimistic state; next write/sync will reconcile.
    }
  },

  removeSet: async (setId) => {
    const { activeWorkout: w } = get();
    if (!w) return;
    set({
      activeWorkout: {
        ...w,
        exercises: w.exercises.map((ex) => {
          if (!ex.sets.some((s) => s.id === setId)) return ex;
          return { ...ex, sets: ex.sets.filter((s) => s.id !== setId) };
        }),
      },
    });
    try {
      await WorkoutRepository.deleteSet(setId);
    } catch {
      // Keep optimistic removal
    }
  },

  cycleSetType: async (setId) => {
    const { activeWorkout: w } = get();
    if (!w) return;
    let s: SetData | undefined;
    for (const ex of w.exercises) {
      s = ex.sets.find((xs) => xs.id === setId);
      if (s) break;
    }
    if (!s) return;

    const isNormal = !s.isWarmup && !s.isDropset && !s.isFailure;
    if (isNormal) await get().updateSet(setId, { isWarmup: true, isDropset: false, isFailure: false });
    else if (s.isWarmup) await get().updateSet(setId, { isWarmup: false, isDropset: true, isFailure: false });
    else if (s.isDropset) await get().updateSet(setId, { isWarmup: false, isDropset: false, isFailure: true });
    else await get().updateSet(setId, { isWarmup: false, isDropset: false, isFailure: false });
  },
}));
