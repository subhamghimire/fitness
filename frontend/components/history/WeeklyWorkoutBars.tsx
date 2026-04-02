import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import type { WeeklyWorkoutData } from '@/utils/analytics';

interface Props {
  data: WeeklyWorkoutData[];
  weightUnit: 'kg' | 'lb';
}

export function WeeklyWorkoutBars({ data, weightUnit }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, data.length - 1));

  const maxWorkouts = useMemo(() => Math.max(...data.map((item) => item.workouts), 1), [data]);
  const selected = data[selectedIndex];

  if (data.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.chartRow}>
        {data.map((item, index) => {
          const h = Math.max(8, (item.workouts / maxWorkouts) * 116);
          const isActive = index === selectedIndex;
          return (
            <TouchableOpacity
              key={item.weekStart}
              style={styles.barHit}
              onPress={() => setSelectedIndex(index)}
              activeOpacity={0.8}
            >
              <View style={[styles.barTrack, { backgroundColor: c.surfaceElevated }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: h,
                      backgroundColor: isActive ? c.accent : c.accentMid,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: isActive ? c.text : c.textSecondary }]} numberOfLines={1}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {selected && (
        <View style={[styles.detailCard, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}> 
          <Text style={[styles.detailTitle, { color: c.text }]}>Week of {selected.label}</Text>
          <Text style={[styles.detailText, { color: c.textSecondary }]}>Workouts: {selected.workouts}</Text>
          <Text style={[styles.detailText, { color: c.textSecondary }]}>Sets: {selected.sets}</Text>
          <Text style={[styles.detailText, { color: c.textSecondary }]}>Volume: {(selected.volume / 1000).toFixed(1)}k {weightUnit}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 14,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  barHit: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: '100%',
    maxWidth: 28,
    height: 120,
    borderRadius: 10,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    borderRadius: 10,
  },
  barLabel: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '700',
  },
  detailCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  detailText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
