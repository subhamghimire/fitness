import { getSyncMeta, updateSyncMeta } from '@/db/syncMeta';
import { collectDirtyChanges, hasAnyChanges, markEntitiesAccepted } from '@/sync/dirty';
import { countPendingChanges } from '@/db/queries';
import type { SyncAcceptedItem, SyncBatchChanges, SyncMeta } from '@/types';

export const SyncRepository = {
  getMeta: (): Promise<SyncMeta> => getSyncMeta(),
  updateMeta: updateSyncMeta,
  collectDirty: (limit?: number) => collectDirtyChanges(limit),
  hasChanges: hasAnyChanges,
  markAccepted: (accepted: SyncAcceptedItem[], serverTime: string) => markEntitiesAccepted(accepted, serverTime),
  countPending: () => countPendingChanges(),
  emptyChanges(): SyncBatchChanges {
    return {
      workouts: [],
      workoutExercises: [],
      sets: [],
      templates: [],
      templateExercises: [],
      templateSets: [],
    };
  },
};
