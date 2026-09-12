const palette = {
  // Primary CTA — warm rust, used for Start / Finish only
  accent: '#D94A32',
  accentSoft: 'rgba(217, 74, 50, 0.12)',
  accentMid: 'rgba(217, 74, 50, 0.22)',

  success: '#30D158',
  successSoft: 'rgba(48, 209, 88, 0.16)',
  danger: '#FF453A',
  dangerSoft: 'rgba(255, 69, 58, 0.14)',
  warning: '#FF9F0A',
  warningSoft: 'rgba(255, 159, 10, 0.14)',

  dropSet: '#BF5AF2',
  dropSetSoft: 'rgba(191, 90, 242, 0.14)',
  warmup: '#0A84FF',
  warmupSoft: 'rgba(10, 132, 255, 0.14)',
};

export const C = {
  dark: {
    background: '#000000',
    surface: '#1C1C1E',
    surfaceElevated: '#2C2C2E',
    grouped: '#000000',
    border: 'rgba(84, 84, 88, 0.65)',
    tint: palette.accent,
    text: '#FFFFFF',
    textSecondary: '#8E8E93',
    textTertiary: '#636366',
    textGhost: '#48484A',
    tabIconDefault: '#636366',
    tabIconSelected: palette.accent,
    ...palette,
  },
  light: {
    background: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceElevated: '#E5E5EA',
    grouped: '#F2F2F7',
    border: 'rgba(60, 60, 67, 0.18)',
    tint: palette.accent,
    text: '#000000',
    textSecondary: '#6C6C70',
    textTertiary: '#8E8E93',
    textGhost: '#C7C7CC',
    tabIconDefault: '#8E8E93',
    tabIconSelected: palette.accent,
    ...palette,
  },
};

export default {
  light: {
    text: C.light.text,
    background: C.light.background,
    tint: C.light.tint,
    tabIconDefault: C.light.tabIconDefault,
    tabIconSelected: C.light.tabIconSelected,
  },
  dark: {
    text: C.dark.text,
    background: C.dark.background,
    tint: C.dark.tint,
    tabIconDefault: C.dark.tabIconDefault,
    tabIconSelected: C.dark.tabIconSelected,
  },
};
