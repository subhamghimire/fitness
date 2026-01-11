import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { getCompletedUnsyncedWorkouts, markWorkoutAsSynced } from '@/db/queries';
import { syncApi } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import type { SyncResult, SyncPayload, Workout } from '@/types';
class SyncService {
  private intervalId: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private isInitialized = false;
  private appStateSubscription: any = null;
  private netInfoSubscription: (() => void) | null = null;
  private lastAppState: AppStateStatus = 'active';
  private isConnected = true;
  initialize(): void {
    if (this.isInitialized) return;
    this.startPeriodicSync();
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    this.netInfoSubscription = NetInfo.addEventListener(this.handleConnectivityChange);
    this.isInitialized = true;
  }
  cleanup(): void {
    this.stopPeriodicSync();
    if (this.appStateSubscription) { this.appStateSubscription.remove(); this.appStateSubscription = null; }
    if (this.netInfoSubscription) { this.netInfoSubscription(); this.netInfoSubscription = null; }
    this.isInitialized = false;
  }
  private handleAppStateChange = (next: AppStateStatus): void => {
    if (this.lastAppState.match(/inactive|background/) && next === 'active') this.syncCompletedWorkouts();
    if (this.lastAppState === 'active' && next.match(/inactive|background/)) this.syncCompletedWorkouts();
    this.lastAppState = next;
  };
  private handleConnectivityChange = (state: NetInfoState): void => {
    const was = !this.isConnected; this.isConnected = state.isConnected ?? false;
    if (was && this.isConnected) this.syncCompletedWorkouts();
  };
  startPeriodicSync(ms: number = 30000): void { if (this.intervalId) this.stopPeriodicSync(); this.intervalId = setInterval(() => this.syncCompletedWorkouts(), ms); }
  stopPeriodicSync(): void { if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; } }
  triggerSync(): void { this.syncCompletedWorkouts(); }
  async syncCompletedWorkouts(): Promise<SyncResult> {
    if (this.isSyncing || !this.isConnected || !useAuthStore.getState().isAuthenticated) return { success: false, syncedWorkoutIds: [], errors: [] };
    this.isSyncing = true;
    const syncedWorkoutIds: string[] = []; const errors: string[] = [];
    try {
      const workouts = await getCompletedUnsyncedWorkouts();
      for (const w of workouts) {
        try { await syncApi.syncWorkouts(this.buildPayload(w)); await markWorkoutAsSynced(w.id); syncedWorkoutIds.push(w.id); }
        catch (e: any) { errors.push(`${w.id}: ${e.message}`); }
      }
      return { success: errors.length === 0, syncedWorkoutIds, errors };
    } finally { this.isSyncing = false; }
  }
  private buildPayload(w: Workout): SyncPayload {
    return { workout: { id: w.id, startedAt: w.startedAt, endedAt: w.endedAt, exercises: w.exercises.map(ex => ({ id: ex.id, name: ex.name, orderIndex: ex.orderIndex, sets: ex.sets.map(s => ({ id: s.id, weight: s.weight, reps: s.reps, rpe: s.rpe, isWarmup: s.isWarmup })) })) } };
  }
  getSyncStatus() { return { isSyncing: this.isSyncing, isConnected: this.isConnected }; }
}
export const syncService = new SyncService();
