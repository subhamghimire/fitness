import { useColorScheme as useRNColorScheme } from 'react-native';
import { useThemeStore } from '@/store/theme.store';

export function useColorScheme() {
  const systemScheme = useRNColorScheme();
  const mode = useThemeStore((state) => state.mode);

  if (mode === 'system') {
    return systemScheme ?? 'light';
  }

  return mode;
}
