import React, { useCallback, useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, Alert, TouchableOpacity, useWindowDimensions
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { getAllWorkouts } from '@/db/queries';
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
      const w = await getAllWorkouts();
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
          colorHex="#FF453A"
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

      {/* Heatmap */}
      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.sectionHeader}>
          <FontAwesome name="calendar" size={16} color={c.textSecondary} />
          <Text style={[styles.sectionTitle, { color: c.text }]}>Consistency Map</Text>
        </View>
        <HeatmapCalendar heatmapData={heatmap} activityByDate={dailyActivity} weightUnit={unit} weeksToShow={16} />
      </View>

      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border, marginBottom: 16 }]}>
        <View style={styles.sectionHeader}>
          <FontAwesome name="bar-chart" size={16} color={c.textSecondary} />
          <Text style={[styles.sectionTitle, { color: c.text }]}>Workouts Per Week</Text>
        </View>
        <WeeklyWorkoutBars data={weeklyWorkouts} weightUnit={unit} />
      </View>

      {/* Smart Insights */}
      {insights.length > 0 && (
        <View style={[styles.insightCard, { backgroundColor: c.accentSoft }]}>
          <FontAwesome name="lightbulb-o" size={18} color={c.accent} />
          <Text style={[styles.insightText, { color: c.accent }]}>{insights[0]}</Text>
        </View>
      )}

      {/* Progress Chart */}
      {chartData.data.length >= 2 && (
        <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border, marginTop: 16 }]}>
          <View style={styles.sectionHeader}>
            <FontAwesome name="line-chart" size={16} color={c.textSecondary} />
            <Text style={[styles.sectionTitle, { color: c.text }]}>{chartData.name} Max Weight</Text>
          </View>
          <ProgressChart data={chartData.data} colorHex={c.accent} />
        </View>
      )}

      <Text style={[styles.listHeader, { color: c.text }]}>Recent Workouts</Text>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={[styles.emptyIconBox, { backgroundColor: c.surfaceElevated }]}>
        <FontAwesome name="rocket" size={48} color={c.accent} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.text }]}>No Workouts Yet</Text>
      <Text style={[styles.emptySub, { color: c.textSecondary }]}>Start logging today and watch your progress map light up!</Text>
      
      <TouchableOpacity 
        style={[styles.emptyBtn, { backgroundColor: c.accent }]} 
        onPress={() => router.push('/')}
        activeOpacity={0.8}
      >
        <Text style={styles.emptyBtnText}>Start your first workout</Text>
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
  pageTitle: { fontSize: 28, fontWeight: '800', marginHorizontal: 16, marginTop: 16, marginBottom: 20, letterSpacing: -0.5 },
  summaryGrid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    paddingVertical: 16,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 20,
    gap: 12,
    marginBottom: 16,
  },
  insightText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    lineHeight: 20,
  },
  listHeader: {
    fontSize: 20,
    fontWeight: '700',
    marginHorizontal: 16,
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  listItemWrap: {
    paddingHorizontal: 16,
  },
  empty: { alignItems: 'center', gap: 12, padding: 32 },
  emptyIconBox: { width: 100, height: 100, borderRadius: 50, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '800' },
  emptySub: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100 },
  emptyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
