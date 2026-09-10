import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { ProgressionStyle } from '@/utils/progression';

const PROGRESSION_STYLE_KEY = 'progression_style';

interface PreferencesState {
  progressionStyle: ProgressionStyle;
  initialize: () => Promise<void>;
  setProgressionStyle: (style: ProgressionStyle) => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  progressionStyle: 'double',

  initialize: async () => {
    try {
      const saved = await AsyncStorage.getItem(PROGRESSION_STYLE_KEY);
      if (saved === 'double' || saved === 'weight' || saved === 'reps' || saved === 'manual') {
        set({ progressionStyle: saved });
      }
    } catch (error) {
      console.warn('Failed to load preferences', error);
    }
  },

  setProgressionStyle: async (style) => {
    set({ progressionStyle: style });
    try {
      await AsyncStorage.setItem(PROGRESSION_STYLE_KEY, style);
    } catch (error) {
      console.warn('Failed to save progression style', error);
    }
  },
}));
