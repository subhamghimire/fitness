export interface User { id: string; email: string; createdAt: string; }
export interface AuthState { token: string | null; user: User | null; isAuthenticated: boolean; isLoading: boolean; }
export interface SetData { id: string; exerciseId: string; weight: number | null; reps: number | null; isWarmup: boolean; isDropset: boolean; isFailure: boolean; isCompleted?: boolean; }
export interface Exercise { id: string; workoutId: string; name: string; orderIndex: number; notes?: string | null; sets: SetData[]; }
export interface Workout { id: string; status: 'active' | 'completed' | 'synced'; startedAt: string; endedAt: string | null; lastSyncedAt: string | null; exercises: Exercise[]; }
export interface WorkoutLocal { id: string; status: string; started_at: string; ended_at: string | null; last_synced_at: string | null; }
export interface ExerciseLocal { id: string; workout_id: string; name: string; order_index: number; notes: string | null; }
export interface SetLocal { id: string; exercise_id: string; weight: number | null; reps: number | null; is_warmup: number; is_dropset: number; is_failure: number; is_completed: number; }

export interface TemplateSet { id: string; weight: number | null; reps: number | null; isWarmup: boolean; isDropset: boolean; isFailure: boolean; }
export interface TemplateExercise { id: string; templateId: string; name: string; orderIndex: number; sets: TemplateSet[]; }
export interface Template { id: string; name: string; createdAt: string; exercises: TemplateExercise[]; }

export interface TemplateLocal { id: string; name: string; created_at: string; }
export interface TemplateExerciseLocal { id: string; template_id: string; name: string; order_index: number; }
export interface TemplateSetLocal { id: string; template_exercise_id: string; weight: number | null; reps: number | null; is_warmup: number; is_dropset: number; is_failure: number; }

export interface SyncPayload { workout: { id: string; startedAt: string; endedAt: string | null; exercises: { id: string; name: string; orderIndex: number; notes?: string | null; sets: { id: string; weight: number | null; reps: number | null; isWarmup: boolean; isDropset: boolean; isFailure: boolean; }[]; }[]; }; }
export interface SyncResult { success: boolean; syncedWorkoutIds: string[]; errors: string[]; }
export interface AuthResponse { tokens: { accessToken: string; refreshToken: string; expiresIn: number; }; user: User; }
