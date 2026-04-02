import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_MODE_KEY = 'theme_mode';

interface ThemeState {
  mode: ThemePreference;
  isHydrated: boolean;
  initialize: () => Promise<void>;
  setMode: (mode: ThemePreference) => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'dark',
  isHydrated: false,

  initialize: async () => {
    try {
      const savedMode = await AsyncStorage.getItem(THEME_MODE_KEY);
      if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
        set({ mode: savedMode, isHydrated: true });
        return;
      }
    } catch (error) {
      console.warn('Failed to load theme preference', error);
    }

    set({ isHydrated: true });
  },

  setMode: async (mode) => {
    set({ mode });

    try {
      await AsyncStorage.setItem(THEME_MODE_KEY, mode);
    } catch (error) {
      console.warn('Failed to save theme preference', error);
    }
  },
}));
