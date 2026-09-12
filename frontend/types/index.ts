export type Gender = 'male' | 'female' | 'other';

export interface User {
  id: string;
  email: string;
  name?: string;
  photoUrl?: string | null;
  age?: number | null;
  gender?: Gender | null;
  createdAt: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type WorkoutLifecycleStatus = 'active' | 'completed';
export type SyncStatus = 'pending' | 'synced' | 'conflict';
export type EntityOp = 'upsert' | 'delete';

export interface SyncFields {
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  localUpdatedAt: string;
  serverUpdatedAt: string | null;
  deletedAt: string | null;
  syncStatus: SyncStatus;
  revision: number;
  lastSyncedRevision: number | null;
}

export interface SetData {
  id: string;
  exerciseId: string;
  orderIndex: number;
  weight: number | null;
  reps: number | null;
  isWarmup: boolean;
  isDropset: boolean;
  isFailure: boolean;
  isCompleted?: boolean;
  syncStatus?: SyncStatus;
  revision?: number;
}

export interface Exercise {
  id: string;
  workoutId: string;
  name: string;
  orderIndex: number;
  notes?: string | null;
  restSeconds?: number | null;
  sets: SetData[];
  syncStatus?: SyncStatus;
  revision?: number;
}

export interface Workout {
  id: string;
  /** Workout lifecycle: active | completed (synced is tracked via syncStatus) */
  status: WorkoutLifecycleStatus;
  startedAt: string;
  endedAt: string | null;
  name?: string | null;
  notes?: string | null;
  lastSyncedAt: string | null;
  syncStatus: SyncStatus;
  revision: number;
  exercises: Exercise[];
}

export interface WorkoutLocal {
  id: string;
  status: string;
  name: string | null;
  notes: string | null;
  started_at: string;
  ended_at: string | null;
  last_synced_at: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface ExerciseLocal {
  id: string;
  workout_id: string;
  name: string;
  order_index: number;
  notes: string | null;
  rest_seconds: number | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface SetLocal {
  id: string;
  exercise_id: string;
  order_index: number;
  weight: number | null;
  reps: number | null;
  is_warmup: number;
  is_dropset: number;
  is_failure: number;
  is_completed: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface TemplateSet {
  id: string;
  templateExerciseId?: string;
  weight: number | null;
  reps: number | null;
  isWarmup: boolean;
  isDropset: boolean;
  isFailure: boolean;
  orderIndex?: number;
}

export interface TemplateExercise {
  id: string;
  templateId: string;
  name: string;
  orderIndex: number;
  sets: TemplateSet[];
}

export interface Template {
  id: string;
  name: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  exercises: TemplateExercise[];
}

export interface TemplateLocal {
  id: string;
  name: string;
  created_at: string;
  user_id: string | null;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface TemplateExerciseLocal {
  id: string;
  template_id: string;
  name: string;
  order_index: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface TemplateSetLocal {
  id: string;
  template_exercise_id: string;
  order_index: number;
  weight: number | null;
  reps: number | null;
  is_warmup: number;
  is_dropset: number;
  is_failure: number;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  local_updated_at: string;
  server_updated_at: string | null;
  deleted_at: string | null;
  sync_status: string;
  revision: number;
  last_synced_revision: number | null;
}

export interface SyncMeta {
  key: string;
  lastSyncToken: string | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastError: string | null;
  clientId: string | null;
}

export type SyncUiStatus = 'idle' | 'syncing' | 'pending' | 'offline' | 'failed' | 'conflict';

export interface SyncChangeItem {
  op: EntityOp;
  id: string;
  revision: number;
  localUpdatedAt: string;
  payload?: Record<string, unknown> | null;
}

export interface SyncBatchChanges {
  workouts: SyncChangeItem[];
  workoutExercises: SyncChangeItem[];
  sets: SyncChangeItem[];
  templates: SyncChangeItem[];
  templateExercises: SyncChangeItem[];
  templateSets: SyncChangeItem[];
}

export interface SyncBatchRequest {
  lastSyncToken: string | null;
  clientId: string;
  changes: SyncBatchChanges;
}

export interface SyncAcceptedItem {
  entityType: string;
  id: string;
  revision: number;
}

export interface SyncRejectedItem {
  entityType: string;
  id: string;
  reason: string;
  serverRevision?: number;
}

export interface SyncConflictItem {
  entityType: string;
  id: string;
  clientRevision: number;
  serverRevision: number;
  resolvedWith: 'server' | 'client' | 'merged';
  winningPayload?: Record<string, unknown>;
}

export interface SyncBatchResponse {
  syncToken: string;
  serverTime: string;
  accepted: SyncAcceptedItem[];
  rejected: SyncRejectedItem[];
  serverChanges: SyncBatchChanges;
  conflicts: SyncConflictItem[];
}

/** @deprecated Legacy full-tree push payload — kept for adapter compatibility */
export interface SyncPayload {
  workout: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    exercises: {
      id: string;
      name: string;
      orderIndex: number;
      notes?: string | null;
      sets: {
        id: string;
        weight: number | null;
        reps: number | null;
        isWarmup: boolean;
        isDropset: boolean;
        isFailure: boolean;
      }[];
    }[];
  };
}

export interface SyncResult {
  success: boolean;
  syncedWorkoutIds: string[];
  errors: string[];
  conflicts?: SyncConflictItem[];
}

export interface AuthResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  user: User;
}
