const palette = {
  // Brand
  accent: '#5E5CE6', // Futuristic rich purple/blue
  accentSoft: 'rgba(94, 92, 230, 0.15)',
  accentMid: 'rgba(94, 92, 230, 0.25)',

  // Semantic
  success: '#32D74B', // Vibrant green
  successSoft: 'rgba(50, 215, 75, 0.15)',
  danger: '#FF453A', // Failure set red
  dangerSoft: 'rgba(255, 69, 58, 0.15)',
  warning: '#FF9F0A', // General warning orange
  warningSoft: 'rgba(255, 159, 10, 0.15)',
  
  // Set Types
  dropSet: '#BF5AF2', // Drop set purple
  dropSetSoft: 'rgba(191, 90, 242, 0.15)',
  warmup: '#0A84FF', // Warm-up blue
  warmupSoft: 'rgba(10, 132, 255, 0.15)',
};

export const C = {
  dark: {
    background: '#0F1115',
    surface: '#1A1C23',
    surfaceElevated: '#252731',
    border: '#2E303B',
    tint: palette.accent,
    text: '#FFFFFF',
    textSecondary: '#8E8EA0', // Strong clean grey
    textTertiary: '#48485A',
    textGhost: '#343442',
    tabIconDefault: '#48485A',
    tabIconSelected: palette.accent,
    ...palette,
  },
  light: {
    background: '#F5F5FA',
    surface: '#FFFFFF',
    surfaceElevated: '#EFEFFA',
    border: '#E5E5F0',
    tint: palette.accent,
    text: '#0F1115',
    textSecondary: '#6B6B80',
    textTertiary: '#ADADC0',
    textGhost: '#D1D1DF',
    tabIconDefault: '#ADADC0',
    tabIconSelected: palette.accent,
    ...palette,
  },
};

// Keep legacy default export shape so old imports don't break
export default {
  light: { text: C.light.text, background: C.light.background, tint: C.light.tint, tabIconDefault: C.light.tabIconDefault, tabIconSelected: C.light.tabIconSelected },
  dark:  { text: C.dark.text,  background: C.dark.background,  tint: C.dark.tint,  tabIconDefault: C.dark.tabIconDefault,  tabIconSelected: C.dark.tabIconSelected  },
};
