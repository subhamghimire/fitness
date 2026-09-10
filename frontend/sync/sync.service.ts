import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { syncApi } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import { useSyncStore } from '@/store/sync.store';
import { SyncRepository } from '@/repositories/sync.repository';
import { applyServerChanges } from '@/sync/applyServerChanges';
import { shouldSyncNow } from '@/sync/conflict';
import { generateId } from '@/utils/uuid';
import type { SyncResult, SyncBatchChanges } from '@/types';

const HEARTBEAT_MS = 30 * 60 * 1000; // 30 minutes

class SyncService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private isInitialized = false;
  private appStateSubscription: { remove: () => void } | null = null;
  private netInfoSubscription: (() => void) | null = null;
  private lastAppState: AppStateStatus = 'active';
  private isConnected = true;

  initialize(): void {
    if (this.isInitialized) return;
    this.startHeartbeat();
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    this.netInfoSubscription = NetInfo.addEventListener(this.handleConnectivityChange);
    this.isInitialized = true;
    void this.refreshPendingCount();
    void this.maybeSync('foreground');
  }

  cleanup(): void {
    this.stopHeartbeat();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    if (this.netInfoSubscription) {
      this.netInfoSubscription();
      this.netInfoSubscription = null;
    }
    this.isInitialized = false;
  }

  private handleAppStateChange = (next: AppStateStatus): void => {
    if (this.lastAppState.match(/inactive|background/) && next === 'active') {
      void this.maybeSync('foreground');
    }
    this.lastAppState = next;
  };

  private handleConnectivityChange = (state: NetInfoState): void => {
    const wasOffline = !this.isConnected;
    this.isConnected = state.isConnected ?? false;
    useSyncStore.getState().setConnected(this.isConnected);
    if (!this.isConnected) {
      useSyncStore.getState().setStatus('offline');
    }
    if (wasOffline && this.isConnected) {
      void this.maybeSync('reconnect');
    }
  };

  startHeartbeat(ms: number = HEARTBEAT_MS): void {
    this.stopHeartbeat();
    this.intervalId = setInterval(() => void this.maybeSync('heartbeat'), ms);
  }

  stopHeartbeat(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  triggerSync(): void {
    void this.maybeSync('manual', true);
  }

  /** @deprecated Use triggerSync / syncNow */
  async syncCompletedWorkouts(): Promise<SyncResult> {
    return this.syncNow('manual');
  }

  async maybeSync(
    reason: 'manual' | 'reconnect' | 'foreground' | 'heartbeat' | 'workout_completed' | 'login',
    force = false
  ): Promise<SyncResult> {
    const meta = await SyncRepository.getMeta();
    const pendingCount = await SyncRepository.countPending();
    useSyncStore.getState().setPendingCount(pendingCount);

    const due = shouldSyncNow({
      lastSuccessfulSyncAt: meta.lastSuccessfulSyncAt,
      pendingCount,
      force,
      reason,
    });
    if (!due) {
      if (pendingCount > 0 && this.isConnected) {
        useSyncStore.getState().setStatus('pending');
      } else if (!this.isConnected) {
        useSyncStore.getState().setStatus('offline');
      } else {
        useSyncStore.getState().setStatus('idle');
      }
      return { success: true, syncedWorkoutIds: [], errors: [] };
    }
    return this.syncNow(reason);
  }

  async syncNow(
    reason: 'manual' | 'reconnect' | 'foreground' | 'heartbeat' | 'workout_completed' | 'login' = 'manual'
  ): Promise<SyncResult> {
    if (this.isSyncing) {
      return { success: false, syncedWorkoutIds: [], errors: ['Sync already in progress'] };
    }
    if (!this.isConnected) {
      useSyncStore.getState().setStatus('offline');
      return { success: false, syncedWorkoutIds: [], errors: ['Offline'] };
    }
    if (!useAuthStore.getState().isAuthenticated) {
      return { success: false, syncedWorkoutIds: [], errors: ['Not authenticated'] };
    }

    this.isSyncing = true;
    useSyncStore.getState().setStatus('syncing');
    const errors: string[] = [];
    const syncedWorkoutIds: string[] = [];

    try {
      await SyncRepository.updateMeta({ lastAttemptedSyncAt: new Date().toISOString(), lastError: null });

      let meta = await SyncRepository.getMeta();
      let clientId = meta.clientId;
      if (!clientId) {
        clientId = generateId();
        await SyncRepository.updateMeta({ clientId });
      }

      let loops = 0;
      let lastConflicts = 0;

      while (loops < 10) {
        loops += 1;
        const changes = await SyncRepository.collectDirty(200);
        const response = await syncApi.syncBatch({
          lastSyncToken: meta.lastSyncToken,
          clientId,
          changes,
        });

        await SyncRepository.markAccepted(response.accepted, response.serverTime);
        await applyServerChanges(response.serverChanges || emptyChanges());

        for (const a of response.accepted) {
          if (a.entityType === 'workout') syncedWorkoutIds.push(a.id);
        }

        lastConflicts = response.conflicts?.length ?? 0;
        await SyncRepository.updateMeta({
          lastSyncToken: response.syncToken,
          lastSuccessfulSyncAt: response.serverTime,
          lastError: null,
        });
        meta = await SyncRepository.getMeta();
        useSyncStore.getState().setLastSuccessfulSyncAt(response.serverTime);

        const stillDirty = await SyncRepository.collectDirty(1);
        if (!SyncRepository.hasChanges(stillDirty)) break;
        // If server rejected everything and nothing accepted, stop to avoid loop
        if (response.accepted.length === 0 && SyncRepository.hasChanges(changes)) {
          errors.push('No changes accepted; will retry later');
          break;
        }
      }

      const pendingCount = await SyncRepository.countPending();
      useSyncStore.getState().setPendingCount(pendingCount);

      if (lastConflicts > 0) {
        useSyncStore.getState().setStatus('conflict');
      } else if (pendingCount > 0) {
        useSyncStore.getState().setStatus('pending');
      } else {
        useSyncStore.getState().setStatus('idle');
      }

      return {
        success: errors.length === 0,
        syncedWorkoutIds: [...new Set(syncedWorkoutIds)],
        errors,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(message);
      await SyncRepository.updateMeta({ lastError: message });
      useSyncStore.getState().setLastError(message);
      useSyncStore.getState().setStatus('failed');
      return { success: false, syncedWorkoutIds, errors };
    } finally {
      this.isSyncing = false;
      void reason;
    }
  }

  async refreshPendingCount(): Promise<void> {
    try {
      const n = await SyncRepository.countPending();
      useSyncStore.getState().setPendingCount(n);
      const meta = await SyncRepository.getMeta();
      useSyncStore.getState().setLastSuccessfulSyncAt(meta.lastSuccessfulSyncAt);
    } catch {
      // ignore
    }
  }

  getSyncStatus() {
    const store = useSyncStore.getState();
    return {
      isSyncing: this.isSyncing,
      isConnected: this.isConnected,
      status: store.status,
      pendingCount: store.pendingCount,
    };
  }
}

function emptyChanges(): SyncBatchChanges {
  return {
    workouts: [],
    workoutExercises: [],
    sets: [],
    templates: [],
    templateExercises: [],
    templateSets: [],
  };
}

export const syncService = new SyncService();
