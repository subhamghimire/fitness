import { create } from 'zustand';
import { generateId } from '@/utils/uuid';
import { insertTemplate, insertTemplateExercise, insertTemplateSet } from '@/db/templateQueries';
import type { TemplateExercise, TemplateSet } from '@/types';

interface DraftTemplate {
  name: string;
  exercises: TemplateExercise[];
}

interface TemplateState {
  draftTemplate: DraftTemplate | null;
  initDraft: () => void;
  setDraftName: (name: string) => void;
  addExercise: (name: string) => string;
  removeExercise: (exerciseId: string) => void;
  addSet: (exerciseId: string) => void;
  updateSet: (setId: string, data: Partial<TemplateSet>) => void;
  removeSet: (setId: string) => void;
  cycleSetType: (setId: string) => void;
  saveDraft: () => Promise<void>;
  clearDraft: () => void;
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  draftTemplate: null,

  initDraft: () => set({ draftTemplate: { name: '', exercises: [] } }),
  
  setDraftName: (name) => {
    const draft = get().draftTemplate;
    if (draft) set({ draftTemplate: { ...draft, name } });
  },

  addExercise: (name) => {
    const draft = get().draftTemplate;
    if (!draft) return '';
    const id = generateId();
    const newEx: TemplateExercise = {
      id, templateId: '', name, orderIndex: draft.exercises.length, sets: []
    };
    set({ draftTemplate: { ...draft, exercises: [...draft.exercises, newEx] } });
    return id;
  },

  removeExercise: (exerciseId) => {
    const draft = get().draftTemplate;
    if (!draft) return;
    set({ draftTemplate: { ...draft, exercises: draft.exercises.filter(e => e.id !== exerciseId) } });
  },

  addSet: (exerciseId) => {
    const draft = get().draftTemplate;
    if (!draft) return;
    const ex = draft.exercises.find(e => e.id === exerciseId);
    if (!ex) return;
    
    const last = ex.sets[ex.sets.length - 1];
    const newSet: TemplateSet = {
      id: generateId(), weight: last?.weight ?? null, reps: last?.reps ?? null,
      isWarmup: false, isDropset: false, isFailure: false
    };
    
    set({
      draftTemplate: {
        ...draft,
        exercises: draft.exercises.map(e => e.id === exerciseId ? { ...e, sets: [...e.sets, newSet] } : e)
      }
    });
  },

  updateSet: (setId, data) => {
    const draft = get().draftTemplate;
    if (!draft) return;
    set({
      draftTemplate: {
        ...draft,
        exercises: draft.exercises.map(ex => ({
          ...ex, sets: ex.sets.map(s => s.id === setId ? { ...s, ...data } : s)
        }))
      }
    });
  },

  removeSet: (setId) => {
    const draft = get().draftTemplate;
    if (!draft) return;
    set({
      draftTemplate: {
        ...draft,
        exercises: draft.exercises.map(ex => ({
          ...ex, sets: ex.sets.filter(s => s.id !== setId)
        }))
      }
    });
  },

  cycleSetType: (setId) => {
    const draft = get().draftTemplate;
    if (!draft) return;
    let target: TemplateSet | undefined;
    for (const ex of draft.exercises) {
      target = ex.sets.find(s => s.id === setId);
      if (target) break;
    }
    if (!target) return;

    const isNormal = !target.isWarmup && !target.isDropset && !target.isFailure;
    if (isNormal) get().updateSet(setId, { isWarmup: true, isDropset: false, isFailure: false });
    else if (target.isWarmup) get().updateSet(setId, { isWarmup: false, isDropset: true, isFailure: false });
    else if (target.isDropset) get().updateSet(setId, { isWarmup: false, isDropset: false, isFailure: true });
    else get().updateSet(setId, { isWarmup: false, isDropset: false, isFailure: false });
  },

  saveDraft: async () => {
    const draft = get().draftTemplate;
    if (!draft || !draft.name.trim() || draft.exercises.length === 0) return;
    
    const templateId = generateId();
    await insertTemplate({ id: templateId, name: draft.name.trim(), created_at: new Date().toISOString() });
    
    let exOrder = 0;
    for (const ex of draft.exercises) {
      const exId = generateId();
      await insertTemplateExercise({ id: exId, template_id: templateId, name: ex.name, order_index: exOrder++ });
      
      for (const s of ex.sets) {
        await insertTemplateSet({
          id: generateId(), template_exercise_id: exId, weight: s.weight, reps: s.reps,
          is_warmup: s.isWarmup ? 1 : 0, is_dropset: s.isDropset ? 1 : 0, is_failure: s.isFailure ? 1 : 0
        });
      }
    }
    get().clearDraft();
  },

  clearDraft: () => set({ draftTemplate: null })
}));
