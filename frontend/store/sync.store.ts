import { create } from 'zustand';
import type { SyncUiStatus } from '@/types';

interface SyncStoreState {
  status: SyncUiStatus;
  pendingCount: number;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  isConnected: boolean;
  setStatus: (status: SyncUiStatus) => void;
  setPendingCount: (n: number) => void;
  setLastSuccessfulSyncAt: (iso: string | null) => void;
  setLastError: (err: string | null) => void;
  setConnected: (connected: boolean) => void;
}

export const useSyncStore = create<SyncStoreState>((set) => ({
  status: 'idle',
  pendingCount: 0,
  lastSuccessfulSyncAt: null,
  lastError: null,
  isConnected: true,
  setStatus: (status) => set({ status }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSuccessfulSyncAt: (lastSuccessfulSyncAt) => set({ lastSuccessfulSyncAt }),
  setLastError: (lastError) => set({ lastError }),
  setConnected: (isConnected) => set({ isConnected }),
}));
