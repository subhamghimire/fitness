import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { HeatmapCalendar } from '@/components/history/HeatmapCalendar';
import { ProgressChart } from '@/components/history/ProgressChart';
import { WeeklyWorkoutBars } from '@/components/history/WeeklyWorkoutBars';
import { WorkoutListItem } from '@/components/history/WorkoutListItem';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { useUnitStore } from '@/store/unit.store';
import type { Workout } from '@/types';
import {
  generateHeatmapData,
  getDailyActivity,
  getExerciseProgression,
  getSmartInsights,
  getSummaryMetrics,
  getWeeklyWorkoutData,
} from '@/utils/analytics';
import { getWeeklySummary } from '@/utils/prs';

export default function HistoryScreen() {
  const router = useRouter();
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);

  const loadWorkouts = async () => {
    try {
      setWorkouts(await WorkoutRepository.getHistory(500, 0));
    } catch {
      Alert.alert('Couldn’t load history', 'Pull down to try again.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      void loadWorkouts();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWorkouts();
    setRefreshing(false);
  };

  const metrics = useMemo(() => getSummaryMetrics(workouts), [workouts]);
  const weekSummary = useMemo(() => getWeeklySummary(workouts, unit), [workouts, unit]);
  const dailyActivity = useMemo(() => getDailyActivity(workouts), [workouts]);
  const heatmap = useMemo(() => generateHeatmapData(workouts), [workouts]);
  const weeklyWorkouts = useMemo(() => getWeeklyWorkoutData(workouts, 8), [workouts]);
  const insights = useMemo(() => getSmartInsights(workouts), [workouts]);

  const chartData = useMemo(() => {
    if (workouts.length === 0) return { name: '', data: [] as ReturnType<typeof getExerciseProgression> };
    const counts: Record<string, number> = {};
    workouts.forEach((w) =>
      w.exercises.forEach((e) => {
        counts[e.name] = (counts[e.name] || 0) + 1;
      })
    );
    const topEx = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    if (!topEx) return { name: '', data: [] as ReturnType<typeof getExerciseProgression> };
    return { name: topEx, data: getExerciseProgression(workouts, topEx) };
  }, [workouts]);

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={[styles.weekCard, { backgroundColor: c.surface }]}>
        <Text style={[styles.weekTitle, { color: c.text }]}>This week</Text>
        <Text style={[styles.weekLine, { color: c.textSecondary }]}>
          {weekSummary.workouts} workouts · {weekSummary.workingSets} sets ·{' '}
          {(weekSummary.volume / 1000).toFixed(1)}k {unit}
        </Text>
        <Text style={[styles.lifetime, { color: c.textTertiary }]}>
          {metrics.totalWorkouts} all-time · {metrics.currentStreak} day streak
        </Text>
      </View>

      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setShowStats((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={[styles.toggleText, { color: c.accent }]}>
          {showStats ? 'Hide insights' : 'Show insights'}
        </Text>
        <Ionicons name={showStats ? 'chevron-up' : 'chevron-down'} size={16} color={c.accent} />
      </TouchableOpacity>

      {showStats ? (
        <View style={styles.stats}>
          {insights[0] ? (
            <Text style={[styles.insight, { color: c.textSecondary }]}>{insights[0]}</Text>
          ) : null}
          <View style={[styles.panel, { backgroundColor: c.surface }]}>
            <HeatmapCalendar heatmapData={heatmap} activityByDate={dailyActivity} weightUnit={unit} weeksToShow={16} />
          </View>
          <View style={[styles.panel, { backgroundColor: c.surface }]}>
            <Text style={[styles.panelTitle, { color: c.text }]}>Workouts per week</Text>
            <WeeklyWorkoutBars data={weeklyWorkouts} weightUnit={unit} />
          </View>
          {chartData.data.length >= 2 ? (
            <View style={[styles.panel, { backgroundColor: c.surface }]}>
              <Text style={[styles.panelTitle, { color: c.text }]}>{chartData.name} — max weight</Text>
              <ProgressChart data={chartData.data} colorHex={c.accent} />
            </View>
          ) : null}
        </View>
      ) : null}

      <Text style={[styles.listTitle, { color: c.textSecondary }]}>WORKOUTS</Text>
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
            <WorkoutListItem workout={item} onPress={() => router.push(`/workout/detail/${item.id}`)} />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>No workouts yet</Text>
            <Text style={[styles.emptySub, { color: c.textSecondary }]}>
              Finish a session and it lands here — ready to compare next time.
            </Text>
            <PrimaryButton label="Start a workout" onPress={() => router.push('/(tabs)')} />
          </View>
        }
        contentContainerStyle={[styles.list, workouts.length === 0 && styles.listEmpty]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: 40 },
  listEmpty: { flex: 1, justifyContent: 'center', padding: 16 },
  header: { paddingBottom: 8 },
  weekCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 12, padding: 16, gap: 4 },
  weekTitle: { fontSize: 17, fontWeight: '600' },
  weekLine: { fontSize: 15 },
  lifetime: { fontSize: 13, marginTop: 4 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  toggleText: { fontSize: 15, fontWeight: '500' },
  stats: { gap: 12, marginBottom: 8 },
  insight: { paddingHorizontal: 20, fontSize: 15, lineHeight: 21 },
  panel: { marginHorizontal: 16, borderRadius: 12, paddingVertical: 12, overflow: 'hidden' },
  panelTitle: { fontSize: 15, fontWeight: '600', paddingHorizontal: 14, marginBottom: 4 },
  listTitle: { fontSize: 13, marginHorizontal: 20, marginTop: 8, marginBottom: 4 },
  listItemWrap: { paddingHorizontal: 16 },
  empty: { alignItems: 'center', gap: 12, padding: 28 },
  emptyTitle: { fontSize: 22, fontWeight: '700' },
  emptySub: { fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 8 },
});
