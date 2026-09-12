import axios, { InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, Gender, SyncPayload, SyncBatchRequest, SyncBatchResponse, User } from '@/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
const TOKEN_KEY = 'auth_token';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401) await SecureStore.deleteItemAsync(TOKEN_KEY);
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (email: string, password: string) => api.post<AuthResponse>('/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<AuthResponse>('/auth/register', { email, password }),
  googleLogin: (idToken: string) => api.post<AuthResponse>('/auth/google-login', { idToken }),
};

export type UpdateProfilePayload = {
  name?: string;
  age?: number;
  gender?: Gender;
};

type ServerUser = {
  id: string;
  email: string;
  name?: string;
  photoUrl?: string | null;
  age?: number | null;
  gender?: Gender | null;
  createdAt: string | Date;
};

export function mapServerUser(raw: ServerUser): User {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    photoUrl: raw.photoUrl ?? null,
    age: raw.age ?? null,
    gender: raw.gender ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(raw.createdAt).toISOString(),
  };
}

function isNotFound(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

export const usersApi = {
  getMe: (userId?: string) =>
    api.get<ServerUser>('/users/me').catch((error: unknown) => {
      if (userId && isNotFound(error)) return api.get<ServerUser>(`/users/${userId}`);
      throw error;
    }),
  updateMe: (userId: string, payload: UpdateProfilePayload) =>
    api.patch<ServerUser>('/users/me', payload).catch((error: unknown) => {
      // Render may still be on the older API that only has PUT /users/:id
      if (isNotFound(error)) return api.put<ServerUser>(`/users/${userId}`, payload);
      throw error;
    }),
};

export function apiErrorMessage(error: unknown, fallback = 'Request failed') {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const fromServer = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    return fromServer || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export const syncApi = {
  syncBatch: async (payload: SyncBatchRequest): Promise<SyncBatchResponse> => {
    const { data } = await api.post<SyncBatchResponse>('/sync', payload);
    return data;
  },
  /** @deprecated */
  syncWorkouts: (payload: SyncPayload) =>
    api.post<{ success: boolean; workoutId: string }>('/sync/workouts', payload),
};
