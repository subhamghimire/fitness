import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

interface Props {
  heatmapData: Record<string, number>; // "YYYY-MM-DD" -> 1|2|3|4
  weeksToShow?: number;
}

export function HeatmapCalendar({ heatmapData, weeksToShow = 14 }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  // Generate matrix: cols (weeks) x rows (days of week)
  const matrix = useMemo(() => {
    const today = new Date();
    // Offset to start on Sunday
    const startOffset = today.getDay(); 
    const totalDays = weeksToShow * 7;
    
    // We want the most recent day (today) to be at the bottom-right if possible, 
    // or we construct backwards from today.
    
    const days: string[] = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i + startOffset);
      const tzOffset = d.getTimezoneOffset() * 60000;
      const localStr = new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
      days.push(localStr);
    }

    const weeks: string[][] = [];
    for (let i = 0; i < weeksToShow; i++) {
      weeks.push(days.slice(i * 7, i * 7 + 7));
    }
    
    return weeks;
  }, [weeksToShow]);

  const getColor = (intensity: number) => {
    if (intensity === 4) return '#32D74B'; // Bright Green
    if (intensity === 3) return '#28A745'; // Green
    if (intensity === 2) return '#1A6B29'; // Dark Green
    if (intensity === 1) return '#0F3D17'; // Very Dark Green
    return c.surfaceElevated; // 0 - Empty
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {matrix.map((week, wIndex) => (
          <View key={wIndex} style={styles.column}>
            {week.map((dayStr, dIndex) => {
              const intensity = heatmapData[dayStr] || 0;
              return (
                <Animated.View
                  key={dayStr}
                  style={[
                    styles.square,
                    { backgroundColor: getColor(intensity) }
                  ]}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>
      <View style={styles.legend}>
        <Text style={[styles.legendText, { color: c.textSecondary }]}>Less</Text>
        {[0, 1, 2, 3, 4].map(i => (
          <View key={i} style={[styles.legendSquare, { backgroundColor: getColor(i) }]} />
        ))}
        <Text style={[styles.legendText, { color: c.textSecondary }]}>More</Text>
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
});
