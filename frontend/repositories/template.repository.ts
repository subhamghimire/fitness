import * as templateQueries from '@/db/templateQueries';
import { newSyncDefaults } from '@/db/syncColumns';
import type { Template, TemplateLocal, TemplateExerciseLocal, TemplateSetLocal } from '@/types';

export const TemplateRepository = {
  insert: (t: TemplateLocal) => templateQueries.insertTemplate(t),
  insertExercise: (e: TemplateExerciseLocal) => templateQueries.insertTemplateExercise(e),
  insertSet: (s: TemplateSetLocal) => templateQueries.insertTemplateSet(s),
  getAll: () => templateQueries.getAllTemplates(),
  softDelete: (id: string) => templateQueries.deleteTemplate(id),

  createLocalTemplateRow(partial: { id: string; name: string; created_at: string; user_id?: string | null }): TemplateLocal {
    const sync = newSyncDefaults(partial.user_id ?? null);
    return {
      id: partial.id,
      name: partial.name,
      created_at: partial.created_at,
      user_id: sync.user_id,
      updated_at: sync.updated_at,
      local_updated_at: sync.local_updated_at,
      server_updated_at: sync.server_updated_at,
      deleted_at: sync.deleted_at,
      sync_status: sync.sync_status,
      revision: sync.revision,
      last_synced_revision: sync.last_synced_revision,
    };
  },

  createLocalExerciseRow(partial: {
    id: string;
    template_id: string;
    name: string;
    order_index: number;
  }): TemplateExerciseLocal {
    const sync = newSyncDefaults();
    return {
      id: partial.id,
      template_id: partial.template_id,
      name: partial.name,
      order_index: partial.order_index,
      ...sync,
    };
  },

  createLocalSetRow(partial: {
    id: string;
    template_exercise_id: string;
    order_index?: number;
    weight: number | null;
    reps: number | null;
    is_warmup: number;
    is_dropset: number;
    is_failure: number;
  }): TemplateSetLocal {
    const sync = newSyncDefaults();
    return {
      id: partial.id,
      template_exercise_id: partial.template_exercise_id,
      order_index: partial.order_index ?? 0,
      weight: partial.weight,
      reps: partial.reps,
      is_warmup: partial.is_warmup,
      is_dropset: partial.is_dropset,
      is_failure: partial.is_failure,
      ...sync,
    };
  },
};

export type { Template };
