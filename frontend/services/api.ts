import axios, { InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, SyncPayload } from '@/types';
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
const TOKEN_KEY = 'auth_token';
export const api = axios.create({ baseURL: API_URL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(r => r, async (error) => {
  if (error.response?.status === 401) await SecureStore.deleteItemAsync(TOKEN_KEY);
  return Promise.reject(error);
});
export const authApi = {
  login: (email: string, password: string) => api.post<AuthResponse>('/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<AuthResponse>('/auth/register', { email, password }),
};
export const syncApi = {
  syncWorkouts: (payload: SyncPayload) => api.post<{ success: boolean; workoutId: string }>('/sync/workouts', payload),
};
