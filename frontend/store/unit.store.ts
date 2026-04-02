import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type WeightUnit = 'kg' | 'lb';

const WEIGHT_UNIT_KEY = 'weight_unit';

interface UnitState {
  unit: WeightUnit;
  initialize: () => Promise<void>;
  setUnit: (unit: WeightUnit) => Promise<void>;
}

export const useUnitStore = create<UnitState>((set) => ({
  unit: 'kg',

  initialize: async () => {
    try {
      const saved = await AsyncStorage.getItem(WEIGHT_UNIT_KEY);
      if (saved === 'kg' || saved === 'lb') {
        set({ unit: saved });
      }
    } catch (error) {
      console.warn('Failed to load weight unit', error);
    }
  },

  setUnit: async (unit) => {
    set({ unit });
    try {
      await AsyncStorage.setItem(WEIGHT_UNIT_KEY, unit);
    } catch (error) {
      console.warn('Failed to save weight unit', error);
    }
  },
}));
