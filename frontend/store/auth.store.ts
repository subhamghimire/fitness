import { authApi, mapServerUser, usersApi, type UpdateProfilePayload } from '@/services/api';
import type { User } from '@/types';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  updateProfile: (payload: UpdateProfilePayload) => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearError: () => void;
}

async function persistSession(token: string, user: User) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

function scheduleFirstSync() {
  // Deferred require avoids circular dependency with sync → auth
  setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { syncService } = require('@/sync/sync.service') as typeof import('@/sync/sync.service');
    void syncService.maybeSync('login', true);
  }, 0);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  initialize: async () => {
    set({ isLoading: true });
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const userJson = await SecureStore.getItemAsync(USER_KEY);
    if (token && userJson) {
      set({ token, user: JSON.parse(userJson) as User, isAuthenticated: true, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.login(email, password);
      const token = data.tokens.accessToken;
      const user = mapServerUser(data.user);
      await persistSession(token, user);
      set({ token, user, isAuthenticated: true, isLoading: false });
      scheduleFirstSync();
    } catch (e: any) {
      const msg = e.response?.data?.message || 'Login failed';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  register: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.register(email, password);
      const token = data.tokens.accessToken;
      const user = mapServerUser(data.user);
      await persistSession(token, user);
      set({ token, user, isAuthenticated: true, isLoading: false });
      scheduleFirstSync();
    } catch (e: any) {
      const msg = e.response?.data?.message || 'Registration failed';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  loginWithGoogle: async (idToken) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.googleLogin(idToken);
      const token = data.tokens.accessToken;
      const user = mapServerUser(data.user);
      await persistSession(token, user);
      set({ token, user, isAuthenticated: true, isLoading: false });
      scheduleFirstSync();
    } catch (e: any) {
      const msg = e.response?.data?.message || 'Google login failed';
      set({ isLoading: false, error: msg });
      throw new Error(msg);
    }
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false, error: null });
    // Clear in-memory workout/timer so the next account doesn't inherit UI state
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useWorkoutStore } = require('@/store/workout.store') as typeof import('@/store/workout.store');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useTimerStore } = require('@/store/timer.store') as typeof import('@/store/timer.store');
      useWorkoutStore.getState().clearSession();
      useTimerStore.getState().stopTimer();
    } catch {
      // ignore
    }
  },

  updateProfile: async (payload) => {
    const current = get().user;
    if (!current?.id) throw new Error('Not signed in');
    const { data } = await usersApi.updateMe(current.id, payload);
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const user = mapServerUser({
      ...current,
      ...data,
      photoUrl: data.photoUrl ?? current.photoUrl,
    });
    if (token) await persistSession(token, user);
    set({ user });
  },

  refreshProfile: async () => {
    const current = get().user;
    try {
      const { data } = await usersApi.getMe(current?.id);
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const user = mapServerUser({
        ...current,
        ...data,
        photoUrl: data.photoUrl ?? current?.photoUrl,
      });
      if (token) await persistSession(token, user);
      set({ user });
    } catch {
      // Keep cached user if the request fails
    }
  },

  clearError: () => set({ error: null }),
}));
