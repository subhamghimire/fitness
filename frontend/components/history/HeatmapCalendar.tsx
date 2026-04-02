import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import type { DailyActivity } from '@/utils/analytics';

interface Props {
  heatmapData: Record<string, number>; // "YYYY-MM-DD" -> 1|2|3|4
  activityByDate: Record<string, DailyActivity>;
  weightUnit: 'kg' | 'lb';
  weeksToShow?: number;
}

export function HeatmapCalendar({ heatmapData, activityByDate, weightUnit, weeksToShow = 14 }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const matrix = useMemo(() => {
    const today = new Date();
    const end = new Date(today);
    end.setHours(0, 0, 0, 0);

    const totalDays = weeksToShow * 7;
    const days: string[] = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push(dateStr);
    }

    const weeks: string[][] = [];
    for (let i = 0; i < weeksToShow; i++) {
      weeks.push(days.slice(i * 7, i * 7 + 7));
    }
    return weeks;
  }, [weeksToShow]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selected = selectedDate ? activityByDate[selectedDate] : null;

  const getColor = (intensity: number) => {
    if (intensity === 4) return '#32D74B';
    if (intensity === 3) return '#28A745';
    if (intensity === 2) return '#1A6B29';
    if (intensity === 1) return '#0F3D17';
    return c.surfaceElevated;
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {matrix.map((week, wIndex) => (
          <View key={wIndex} style={styles.column}>
            {week.map((dayStr) => {
              const intensity = heatmapData[dayStr] || 0;
              const isSelected = selectedDate === dayStr;
              return (
                <TouchableOpacity
                  key={dayStr}
                  style={[
                    styles.square,
                    {
                      backgroundColor: getColor(intensity),
                      borderColor: isSelected ? c.accent : 'transparent',
                    },
                  ]}
                  onPress={() => setSelectedDate(dayStr)}
                  activeOpacity={0.8}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: c.textSecondary }]}>Less</Text>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.legendSquare, { backgroundColor: getColor(i) }]} />
        ))}
        <Text style={[styles.legendText, { color: c.textSecondary }]}>More</Text>
      </View>

      <View style={[styles.tipWrap, { borderTopColor: c.border }]}>
        {selected ? (
          <View style={[styles.detailCard, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}> 
            <Text style={[styles.detailTitle, { color: c.text }]}>
              {selected.weekday}, {new Date(`${selected.date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
            <Text style={[styles.detailText, { color: c.textSecondary }]}>Workouts: {selected.workouts}</Text>
            <Text style={[styles.detailText, { color: c.textSecondary }]}>Sets: {selected.sets}</Text>
            <Text style={[styles.detailText, { color: c.textSecondary }]}>Volume: {(selected.volume / 1000).toFixed(1)}k {weightUnit}</Text>
            {selected.topExercise ? (
              <Text style={[styles.detailText, { color: c.textSecondary }]}>Top exercise: {selected.topExercise}</Text>
            ) : null}
          </View>
        ) : (
          <Text style={[styles.tipText, { color: c.textSecondary }]}>Tap any day to see details</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 4,
  },
  column: {
    gap: 4,
  },
  square: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    marginTop: 12,
    gap: 6,
  },
  legendText: {
    fontSize: 10,
    fontWeight: '600',
  },
  legendSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  tipWrap: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  tipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  detailCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  detailTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  detailText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
