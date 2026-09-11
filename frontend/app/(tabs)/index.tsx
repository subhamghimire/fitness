import React, { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useWorkoutStore } from '@/store/workout.store';
import { useAuthStore } from '@/store/auth.store';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { useColorScheme } from '@/components/useColorScheme';
import { formatDate, formatDuration } from '@/utils/date';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { C } from '@/constants/Colors';
import { getWeeklySummary } from '@/utils/prs';
import type { Workout } from '@/types';
import type { WeeklySummary } from '@/utils/prs';

export default function HomeScreen() {
  const [recentWorkouts, setRecentWorkouts] = useState<Workout[]>([]);
  const [weekSummary, setWeekSummary] = useState<WeeklySummary | null>(null);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const c = isDark ? C.dark : C.light;

  const { activeWorkout, startWorkout, loadActiveWorkout } = useWorkoutStore();
  const { user } = useAuthStore();

  useFocusEffect(
    useCallback(() => {
      loadActiveWorkout();
      loadRecentWorkouts();
    }, [])
  );

  const loadRecentWorkouts = async () => {
    try {
      const workouts = await WorkoutRepository.getHistory(80, 0);
      setRecentWorkouts(workouts.slice(0, 5));
      setWeekSummary(getWeeklySummary(workouts));
    } catch (error) {
      console.error('Failed to load recent workouts:', error);
    }
  };

  const handleStartWorkout = async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const workoutId = await startWorkout();
      router.push(`/workout/${workoutId}`);
    } catch {
      Alert.alert('Error', 'Failed to start workout');
    }
  };

  const handleContinueWorkout = () => {
    if (activeWorkout) router.push(`/workout/${activeWorkout.id}`);
  };

  const getTotalSets = (w: Workout) => w.exercises.reduce((s, ex) => s + ex.sets.length, 0);

  const weekWorkouts = recentWorkouts.filter((w) => {
    const ago = new Date();
    ago.setDate(ago.getDate() - 7);
    return new Date(w.startedAt) > ago;
  });

  const displayName = user?.email?.split('@')[0] || 'Athlete';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.greeting}>
        <Text style={[styles.greetSub, { color: c.textSecondary }]}>Ready to train,</Text>
        <Text style={[styles.greetName, { color: c.text }]} numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      {activeWorkout && (
        <TouchableOpacity
          style={[styles.activeBanner, { backgroundColor: c.accent }]}
          onPress={handleContinueWorkout}
          activeOpacity={0.88}
        >
          <View style={styles.activeBannerLeft}>
            <View style={[styles.pulsingDot, { backgroundColor: 'rgba(255,255,255,0.75)' }]} />
            <View>
              <Text style={styles.activeBannerTitle}>Workout in Progress</Text>
              <WorkoutTimer
                startTime={activeWorkout.startedAt}
                textColor="rgba(255,255,255,0.75)"
                fontSize={13}
              />
            </View>
          </View>
          <View style={styles.activeBannerRight}>
            <Text style={styles.activeBannerCta}>Continue</Text>
            <FontAwesome name="chevron-right" size={12} color="#fff" />
          </View>
        </TouchableOpacity>
      )}

      {!activeWorkout && (
        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: c.accent }]}
          onPress={handleStartWorkout}
          activeOpacity={0.85}
        >
          <FontAwesome name="plus" size={16} color="#fff" />
          <Text style={styles.startBtnText}>Start Empty Workout</Text>
        </TouchableOpacity>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: c.text }]}>{weekSummary?.workouts ?? weekWorkouts.length}</Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>This week</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: c.text }]}>
            {weekSummary?.workingSets ?? weekWorkouts.reduce((s, w) => s + getTotalSets(w), 0)}
          </Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>Sets</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: c.text }]}>
            {weekSummary ? `${(weekSummary.volume / 1000).toFixed(1)}k` : recentWorkouts.length}
          </Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>
            {weekSummary ? 'Volume' : 'Recent'}
          </Text>
        </View>
      </View>

      {weekSummary && weekSummary.observations[0] ? (
        <Text style={[styles.weekNote, { color: c.textSecondary }]}>{weekSummary.observations[0]}</Text>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Recent</Text>

        {recentWorkouts.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>No workouts yet</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Start a workout to begin tracking
            </Text>
          </View>
        ) : (
          recentWorkouts.map((workout) => (
            <TouchableOpacity
              key={workout.id}
              style={[styles.workoutRow, { borderBottomColor: c.border }]}
              onPress={() => router.push(`/workout/detail/${workout.id}`)}
              activeOpacity={0.65}
            >
              <View style={styles.workoutCardHead}>
                <Text style={[styles.workoutDate, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
                {workout.syncStatus === 'synced' ? (
                  <Text style={[styles.syncMeta, { color: c.success }]}>Synced</Text>
                ) : workout.syncStatus === 'pending' ? (
                  <Text style={[styles.syncMeta, { color: c.textTertiary }]}>Pending</Text>
                ) : null}
              </View>
              <Text style={[styles.metaItem, { color: c.textSecondary }]}>
                {workout.exercises.length} exercises · {getTotalSets(workout)} sets ·{' '}
                {formatDuration(workout.startedAt, workout.endedAt)}
              </Text>
              {workout.exercises.length > 0 && (
                <Text style={[styles.exerciseChips, { color: c.textTertiary }]} numberOfLines={1}>
                  {workout.exercises.map((e) => e.name).join('  ·  ')}
                </Text>
              )}
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36 },
  greeting: { marginBottom: 20 },
  greetSub: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  greetName: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 14,
  },
  activeBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pulsingDot: { width: 8, height: 8, borderRadius: 4 },
  activeBannerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  activeBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeBannerCta: { color: '#fff', fontSize: 14, fontWeight: '600' },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 20,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    paddingVertical: 4,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  weekNote: { fontSize: 13, fontWeight: '500', marginBottom: 16, lineHeight: 18 },
  section: { gap: 0 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  emptyBlock: { alignItems: 'center', paddingVertical: 28, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 14, textAlign: 'center' },
  workoutRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  workoutCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workoutDate: { fontSize: 15, fontWeight: '600' },
  syncMeta: { fontSize: 11, fontWeight: '600' },
  metaItem: { fontSize: 13, fontWeight: '500' },
  exerciseChips: { fontSize: 12, fontWeight: '400', marginTop: 2 },
});
