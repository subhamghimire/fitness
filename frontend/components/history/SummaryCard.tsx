import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

interface Props {
  title: string;
  value: string;
  subValue?: string;
  icon: keyof typeof FontAwesome.glyphMap;
  colorHex?: string;
  style?: ViewStyle;
}

export function SummaryCard({ title, value, subValue, icon, colorHex, style }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const accentColor = colorHex || c.accent;

  return (
    <View style={[styles.card, { backgroundColor: c.surfaceElevated }, style]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconBox, { backgroundColor: accentColor + '20' }]}>
          <FontAwesome name={icon} size={14} color={accentColor} />
        </View>
        <Text style={[styles.title, { color: c.textSecondary }]}>{title}</Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color: c.text }]} numberOfLines={1}>
          {value}
        </Text>
        {subValue && (
          <Text style={[styles.subValue, { color: accentColor }]}>{subValue}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 100,
    borderRadius: 20,
    padding: 16,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  valueRow: {
    alignItems: 'flex-start',
  },
  value: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subValue: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
