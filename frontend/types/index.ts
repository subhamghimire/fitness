export interface User { id: string; email: string; createdAt: string; }
export interface AuthState { token: string | null; user: User | null; isAuthenticated: boolean; isLoading: boolean; }
export interface SetData { id: string; exerciseId: string; weight: number | null; reps: number | null; rpe: number | null; isWarmup: boolean; }
export interface Exercise { id: string; workoutId: string; name: string; orderIndex: number; sets: SetData[]; }
export interface Workout { id: string; status: 'active' | 'completed' | 'synced'; startedAt: string; endedAt: string | null; lastSyncedAt: string | null; exercises: Exercise[]; }
export interface WorkoutLocal { id: string; status: string; started_at: string; ended_at: string | null; last_synced_at: string | null; }
export interface ExerciseLocal { id: string; workout_id: string; name: string; order_index: number; }
export interface SetLocal { id: string; exercise_id: string; weight: number | null; reps: number | null; rpe: number | null; is_warmup: number; }
export interface SyncPayload { workout: { id: string; startedAt: string; endedAt: string | null; exercises: { id: string; name: string; orderIndex: number; sets: { id: string; weight: number | null; reps: number | null; rpe: number | null; isWarmup: boolean; }[]; }[]; }; }
export interface SyncResult { success: boolean; syncedWorkoutIds: string[]; errors: string[]; }
export interface AuthResponse { token: string; user: User; }
