const palette = {
  // Brand
  accent: '#6C63FF',
  accentSoft: 'rgba(108,99,255,0.15)',
  accentMid: 'rgba(108,99,255,0.25)',

  // Semantic
  success: '#30D158',
  successSoft: 'rgba(48,209,88,0.15)',
  danger: '#FF453A',
  dangerSoft: 'rgba(255,69,58,0.12)',
  warning: '#FF9F0A',
  warningSoft: 'rgba(255,159,10,0.15)',
};

export const C = {
  dark: {
    background: '#0A0A0F',
    surface: '#141418',
    surfaceElevated: '#1E1E26',
    border: '#2A2A36',
    tint: palette.accent,
    text: '#FFFFFF',
    textSecondary: '#8E8EA0',
    textTertiary: '#48485A',
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
    text: '#0A0A0F',
    textSecondary: '#6B6B80',
    textTertiary: '#ADADC0',
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
