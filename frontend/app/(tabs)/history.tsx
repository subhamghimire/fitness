import React, { useCallback, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, Alert, TouchableOpacity, useWindowDimensions
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import type { Workout } from '@/types';
import {
  getSummaryMetrics,
  generateHeatmapData,
  getSmartInsights,
  getExerciseProgression,
  getDailyActivity,
  getWeeklyWorkoutData,
} from '@/utils/analytics';
import { SummaryCard } from '@/components/history/SummaryCard';
import { HeatmapCalendar } from '@/components/history/HeatmapCalendar';
import { WorkoutListItem } from '@/components/history/WorkoutListItem';
import { ProgressChart } from '@/components/history/ProgressChart';
import { WeeklyWorkoutBars } from '@/components/history/WeeklyWorkoutBars';

export default function HistoryScreen() {
  const router = useRouter();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);
  const isCompact = width < 390;
  const summaryCardWidth = useMemo(() => {
    const horizontalPadding = 32;
    const gutter = 12;
    return Math.max(136, (width - horizontalPadding - gutter) / 2);
  }, [width]);

  const loadWorkouts = async () => {
    try {
      const w = await WorkoutRepository.getHistory(500, 0);
      setWorkouts(w);
    } catch (e) {
      Alert.alert('History Error', String(e));
      console.error(e);
    }
  };

  useFocusEffect(useCallback(() => { loadWorkouts(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWorkouts();
    setRefreshing(false);
  };

  const metrics = useMemo(() => getSummaryMetrics(workouts), [workouts]);
  const dailyActivity = useMemo(() => getDailyActivity(workouts), [workouts]);
  const heatmap = useMemo(() => generateHeatmapData(workouts), [workouts]);
  const weeklyWorkouts = useMemo(() => getWeeklyWorkoutData(workouts, 8), [workouts]);
  const insights = useMemo(() => getSmartInsights(workouts), [workouts]);
  
  const chartData = useMemo(() => {
    // Find most frequent exercise to chart
    if (workouts.length === 0) return { name: '', data: [] };
    const counts: Record<string, number> = {};
    workouts.forEach(w => w.exercises.forEach(e => {
      counts[e.name] = (counts[e.name] || 0) + 1;
    }));
    const topEx = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!topEx) return { name: '', data: [] };
    return { name: topEx, data: getExerciseProgression(workouts, topEx) };
  }, [workouts]);

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={[styles.pageTitle, { color: c.text }]}>Progress Hub</Text>
      
      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <SummaryCard 
          title="Total Workouts" 
          value={metrics.totalWorkouts.toString()} 
          icon="trophy" 
          colorHex={c.accent}
          style={{ width: summaryCardWidth }}
        />
        <SummaryCard 
          title="Total Volume" 
          value={`${(metrics.totalVolume / 1000).toFixed(1)}k`} 
          subValue={unit}
          icon="bolt" 
          colorHex={c.warning || '#FF9F0A'}
          style={{ width: summaryCardWidth }}
        />
        <SummaryCard 
          title="Current Streak" 
          value={metrics.currentStreak.toString()} 
          subValue={isCompact ? 'days' : 'Days'}
          icon="fire" 
          colorHex={c.danger}
          style={{ width: summaryCardWidth }}
        />
        <SummaryCard 
          title="Avg Duration" 
          value={`${Math.round(metrics.avgDuration / 60)}`} 
          subValue="mins"
          icon="clock-o" 
          colorHex={c.success}
          style={{ width: summaryCardWidth }}
        />
      </View>

      <View style={[styles.section, { backgroundColor: c.surface }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Consistency</Text>
        </View>
        <HeatmapCalendar heatmapData={heatmap} activityByDate={dailyActivity} weightUnit={unit} weeksToShow={16} />
      </View>

      <View style={[styles.section, { backgroundColor: c.surface, marginBottom: 12 }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Workouts per week</Text>
        </View>
        <WeeklyWorkoutBars data={weeklyWorkouts} weightUnit={unit} />
      </View>

      {insights.length > 0 && (
        <View style={[styles.insightCard, { backgroundColor: c.accentSoft }]}>
          <Text style={[styles.insightText, { color: c.accent }]}>{insights[0]}</Text>
        </View>
      )}

      {chartData.data.length >= 2 && (
        <View style={[styles.section, { backgroundColor: c.surface, marginTop: 8 }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>{chartData.name} — max weight</Text>
          </View>
          <ProgressChart data={chartData.data} colorHex={c.accent} />
        </View>
      )}

      <Text style={[styles.listHeader, { color: c.text }]}>Recent workouts</Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: c.text }]}>No workouts yet</Text>
      <Text style={[styles.emptySub, { color: c.textSecondary }]}>
        Finish a workout and your history will show up here.
      </Text>
      <TouchableOpacity
        style={[styles.emptyBtn, { backgroundColor: c.accent }]}
        onPress={() => router.push('/')}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyBtnText}>Start a workout</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={workouts}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={workouts.length > 0 ? renderHeader : null}
        renderItem={({ item }) => (
          <View style={styles.listItemWrap}>
            <WorkoutListItem 
              workout={item} 
              onPress={() => router.push(`/workout/detail/${item.id}`)} 
            />
          </View>
        )}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[styles.list, workouts.length === 0 && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: 120 },
  listEmpty: { flex: 1, justifyContent: 'center', padding: 16 },
  headerContainer: { paddingBottom: 16 },
  pageTitle: { fontSize: 24, fontWeight: '800', marginHorizontal: 16, marginTop: 12, marginBottom: 16, letterSpacing: -0.4 },
  summaryGrid: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 12,
    gap: 10,
    marginBottom: 12,
  },
  insightText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 20,
  },
  listHeader: {
    fontSize: 17,
    fontWeight: '700',
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
    letterSpacing: -0.2,
  },
  listItemWrap: {
    paddingHorizontal: 16,
  },
  empty: { alignItems: 'center', gap: 10, padding: 28 },
  emptyIconBox: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
