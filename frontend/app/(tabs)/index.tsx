import React, { useEffect, useState } from 'react';
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
import { useWorkoutStore } from '@/store/workout.store';
import { useAuthStore } from '@/store/auth.store';
import { getAllWorkouts } from '@/db/queries';
import { useColorScheme } from '@/components/useColorScheme';
import { formatDate, formatDuration } from '@/utils/date';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { C } from '@/constants/Colors';
import type { Workout } from '@/types';

export default function HomeScreen() {
  const [recentWorkouts, setRecentWorkouts] = useState<Workout[]>([]);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const c = isDark ? C.dark : C.light;

  const { activeWorkout, startWorkout, loadActiveWorkout } = useWorkoutStore();
  const { user } = useAuthStore();

  useEffect(() => {
    loadActiveWorkout();
    loadRecentWorkouts();
  }, []);

  const loadRecentWorkouts = async () => {
    try {
      const workouts = await getAllWorkouts();
      setRecentWorkouts(workouts.slice(0, 5));
    } catch (error) {
      console.error('Failed to load recent workouts:', error);
    }
  };

  const handleStartWorkout = async () => {
    try {
      const workoutId = await startWorkout();
      router.push(`/workout/${workoutId}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to start workout');
    }
  };

  const handleContinueWorkout = () => {
    if (activeWorkout) router.push(`/workout/${activeWorkout.id}`);
  };

  const getTotalSets = (w: Workout) => w.exercises.reduce((s, ex) => s + ex.sets.length, 0);

  const weekWorkouts = recentWorkouts.filter(w => {
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
      {/* Greeting */}
      <View style={styles.greeting}>
        <Text style={[styles.greetSub, { color: c.textSecondary }]}>Ready to train,</Text>
        <Text style={[styles.greetName, { color: c.text }]} numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      {/* Active workout banner */}
      {activeWorkout && (
        <TouchableOpacity
          style={[styles.activeBanner, { backgroundColor: c.accent }]}
          onPress={handleContinueWorkout}
          activeOpacity={0.88}
        >
          <View style={styles.activeBannerLeft}>
            <View style={styles.pulsingDot} />
            <View>
              <Text style={styles.activeBannerTitle}>Workout in Progress</Text>
              <WorkoutTimer startTime={activeWorkout.startedAt} textColor="rgba(255,255,255,0.75)" fontSize={13} />
            </View>
          </View>
          <View style={styles.activeBannerRight}>
            <Text style={styles.activeBannerCta}>Continue</Text>
            <FontAwesome name="chevron-right" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
      )}

      {/* Start Workout CTA */}
      {!activeWorkout && (
        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: c.accent }]}
          onPress={handleStartWorkout}
          activeOpacity={0.85}
        >
          <View style={[styles.startBtnIcon, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <FontAwesome name="plus" size={20} color="#fff" />
          </View>
          <Text style={styles.startBtnText}>Start Empty Workout</Text>
        </TouchableOpacity>
      )}

      {/* Week stats */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.statValue, { color: c.accent }]}>{weekWorkouts.length}</Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>This week</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.statValue, { color: c.accent }]}>
            {weekWorkouts.reduce((s, w) => s + getTotalSets(w), 0)}
          </Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>Total sets</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.statValue, { color: c.accent }]}>{recentWorkouts.length}</Text>
          <Text style={[styles.statLabel, { color: c.textSecondary }]}>All time</Text>
        </View>
      </View>

      {/* Recent workouts */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: c.text }]}>Recent</Text>

        {recentWorkouts.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <FontAwesome name="bolt" size={32} color={c.textTertiary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>No workouts yet</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Tap "Start Empty Workout" to log your first session
            </Text>
          </View>
        ) : (
          recentWorkouts.map((workout) => (
            <View key={workout.id} style={[styles.workoutCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.workoutCardHead}>
                <Text style={[styles.workoutDate, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
                {workout.status === 'synced' ? (
                  <View style={[styles.badge, { backgroundColor: c.successSoft }]}>
                    <Text style={[styles.badgeText, { color: c.success }]}>⬆ Synced</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.workoutMeta}>
                <Text style={[styles.metaItem, { color: c.textSecondary }]}>
                  {workout.exercises.length} exercises
                </Text>
                <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                <Text style={[styles.metaItem, { color: c.textSecondary }]}>
                  {getTotalSets(workout)} sets
                </Text>
                <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                <Text style={[styles.metaItem, { color: c.textSecondary }]}>
                  {formatDuration(workout.startedAt, workout.endedAt)}
                </Text>
              </View>
              {workout.exercises.length > 0 && (
                <Text style={[styles.exerciseChips, { color: c.textSecondary }]} numberOfLines={1}>
                  {workout.exercises.map(e => e.name).join('  ·  ')}
                </Text>
              )}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 40 },
  greeting: { marginBottom: 26 },
  greetSub: { fontSize: 16, fontWeight: '600', letterSpacing: 0.16, marginBottom: 4 },
  greetName: { fontSize: 36, fontWeight: '900', letterSpacing: -1.1, lineHeight: 40 },
  activeBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 18, paddingHorizontal: 18, paddingVertical: 16, marginBottom: 16,
    shadowColor: '#6C63FF', shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  activeBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pulsingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.7)' },
  activeBannerTitle: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  activeBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activeBannerCta: { color: '#fff', fontSize: 14, fontWeight: '600' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderRadius: 22, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 24,
    shadowColor: '#6C63FF', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 7 },
    elevation: 10,
  },
  startBtnIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  startBtnText: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  statCard: {
    flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: 16, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  statValue: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
  statLabel: { fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.36, textTransform: 'uppercase' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, marginBottom: 4 },
  emptyCard: {
    alignItems: 'center', paddingVertical: 40, borderRadius: 16, borderWidth: 1, gap: 10,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptyBody: { fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  workoutCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  workoutCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workoutDate: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  workoutMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItem: { fontSize: 13, fontWeight: '500' },
  metaDot: { fontSize: 13 },
  exerciseChips: { fontSize: 12, fontWeight: '500', letterSpacing: 0.1 },
});
