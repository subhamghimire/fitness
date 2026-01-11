import { authApi } from '@/services/api';
import type { User } from '@/types';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
interface AuthState { token: string | null; user: User | null; isAuthenticated: boolean; isLoading: boolean; error: string | null; login: (email: string, password: string) => Promise<void>; register: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; initialize: () => Promise<void>; clearError: () => void; }
export const useAuthStore = create<AuthState>((set) => ({
  token: null, user: null, isAuthenticated: false, isLoading: true, error: null,
  initialize: async () => {
    set({ isLoading: true });
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const userJson = await SecureStore.getItemAsync(USER_KEY);
    if (token && userJson) { set({ token, user: JSON.parse(userJson), isAuthenticated: true, isLoading: false }); }
    else { set({ isLoading: false }); }
  },
  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      console.log(email, password);
      const { data } = await authApi.login(email, password);
      console.log(data);
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
      set({ token: data.token, user: data.user, isAuthenticated: true, isLoading: false });
    } catch (e: any) { const msg = e.response?.data?.message || 'Login failed'; set({ isLoading: false, error: msg }); throw new Error(msg); }
  },
  register: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await authApi.register(email, password);
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
      set({ token: data.token, user: data.user, isAuthenticated: true, isLoading: false });
    } catch (e: any) { const msg = e.response?.data?.message || 'Registration failed'; set({ isLoading: false, error: msg }); throw new Error(msg); }
  },
  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false, error: null });
  },
  clearError: () => set({ error: null }),
}));
