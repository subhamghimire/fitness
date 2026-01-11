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
import Colors from '@/constants/Colors';
import type { Workout } from '@/types';

export default function HomeScreen() {
  const [recentWorkouts, setRecentWorkouts] = useState<Workout[]>([]);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { activeWorkout, startWorkout, loadActiveWorkout } = useWorkoutStore();
  const { user } = useAuthStore();

  useEffect(() => {
    loadActiveWorkout();
    loadRecentWorkouts();
  }, []);

  const loadRecentWorkouts = async () => {
    try {
      const workouts = await getAllWorkouts();
      setRecentWorkouts(workouts.slice(0, 5)); // Get last 5 workouts
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
    if (activeWorkout) {
      router.push(`/workout/${activeWorkout.id}`);
    }
  };

  const getTotalSets = (workout: Workout): number => {
    return workout.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  };

  const getTotalVolume = (workout: Workout): number => {
    return workout.exercises.reduce((sum, ex) => {
      return sum + ex.sets.reduce((setSum, set) => {
        const weight = set.weight ?? 0;
        const reps = set.reps ?? 0;
        return setSum + weight * reps;
      }, 0);
    }, 0);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.text, opacity: 0.7 }]}>
          Welcome back
        </Text>
        <Text style={[styles.userName, { color: colors.text }]}>
          {user?.email?.split('@')[0] || 'Athlete'}
        </Text>
      </View>

      {/* Active Workout Card */}
      {activeWorkout && (
        <TouchableOpacity
          style={[styles.activeWorkoutCard, { backgroundColor: colors.tint }]}
          onPress={handleContinueWorkout}
          activeOpacity={0.9}
        >
          <View style={styles.activeWorkoutContent}>
            <FontAwesome name="bolt" size={24} color="#fff" />
            <View style={styles.activeWorkoutText}>
              <Text style={styles.activeWorkoutTitle}>Workout in Progress</Text>
              <Text style={styles.activeWorkoutSubtitle}>
                {activeWorkout.exercises.length} exercise(s) • Tap to continue
              </Text>
            </View>
          </View>
          <FontAwesome name="chevron-right" size={18} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Start Workout Button */}
      {!activeWorkout && (
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: colors.tint }]}
          onPress={handleStartWorkout}
          activeOpacity={0.8}
        >
          <FontAwesome name="plus" size={20} color="#fff" />
          <Text style={styles.startButtonText}>Start Workout</Text>
        </TouchableOpacity>
      )}

      {/* Quick Stats */}
      <View style={styles.statsSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          This Week
        </Text>
        <View style={styles.statsGrid}>
          <View
            style={[styles.statCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}
          >
            <Text style={[styles.statValue, { color: colors.tint }]}>
              {recentWorkouts.filter(w => {
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                return new Date(w.startedAt) > weekAgo;
              }).length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.text, opacity: 0.6 }]}>
              Workouts
            </Text>
          </View>
          <View
            style={[styles.statCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}
          >
            <Text style={[styles.statValue, { color: colors.tint }]}>
              {recentWorkouts
                .filter(w => {
                  const weekAgo = new Date();
                  weekAgo.setDate(weekAgo.getDate() - 7);
                  return new Date(w.startedAt) > weekAgo;
                })
                .reduce((sum, w) => sum + getTotalSets(w), 0)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.text, opacity: 0.6 }]}>
              Sets
            </Text>
          </View>
        </View>
      </View>

      {/* Recent Workouts */}
      <View style={styles.recentSection}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Recent Workouts
        </Text>

        {recentWorkouts.length === 0 ? (
          <View
            style={[styles.emptyCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}
          >
            <FontAwesome
              name="calendar-o"
              size={32}
              color={isDark ? '#3a3a3c' : '#c7c7cc'}
            />
            <Text style={[styles.emptyText, { color: colors.text, opacity: 0.6 }]}>
              No workouts yet
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.text, opacity: 0.4 }]}>
              Start your first workout to see it here
            </Text>
          </View>
        ) : (
          <View style={styles.workoutsList}>
            {recentWorkouts.map((workout) => (
              <View
                key={workout.id}
                style={[
                  styles.workoutCard,
                  { backgroundColor: isDark ? '#1c1c1e' : '#fff' },
                ]}
              >
                <View style={styles.workoutCardHeader}>
                  <Text style={[styles.workoutDate, { color: colors.text }]}>
                    {formatDate(workout.startedAt)}
                  </Text>
                  <View
                    style={[
                      styles.syncBadge,
                      {
                        backgroundColor:
                          workout.status === 'synced'
                            ? '#34c759'
                            : isDark
                            ? '#3a3a3c'
                            : '#e5e5ea',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.syncBadgeText,
                        { color: workout.status === 'synced' ? '#fff' : colors.text },
                      ]}
                    >
                      {workout.status === 'synced' ? 'Synced' : 'Local'}
                    </Text>
                  </View>
                </View>

                <View style={styles.workoutStats}>
                  <View style={styles.workoutStat}>
                    <Text style={[styles.workoutStatValue, { color: colors.text }]}>
                      {workout.exercises.length}
                    </Text>
                    <Text
                      style={[styles.workoutStatLabel, { color: colors.text, opacity: 0.6 }]}
                    >
                      Exercises
                    </Text>
                  </View>
                  <View style={styles.workoutStat}>
                    <Text style={[styles.workoutStatValue, { color: colors.text }]}>
                      {getTotalSets(workout)}
                    </Text>
                    <Text
                      style={[styles.workoutStatLabel, { color: colors.text, opacity: 0.6 }]}
                    >
                      Sets
                    </Text>
                  </View>
                  <View style={styles.workoutStat}>
                    <Text style={[styles.workoutStatValue, { color: colors.text }]}>
                      {formatDuration(workout.startedAt, workout.endedAt)}
                    </Text>
                    <Text
                      style={[styles.workoutStatLabel, { color: colors.text, opacity: 0.6 }]}
                    >
                      Duration
                    </Text>
                  </View>
                </View>

                {/* Exercise names preview */}
                <Text
                  style={[styles.exercisePreview, { color: colors.text, opacity: 0.6 }]}
                  numberOfLines={1}
                >
                  {workout.exercises.map((e) => e.name).join(' • ')}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 14,
  },
  userName: {
    fontSize: 28,
    fontWeight: 'bold',
    marginTop: 4,
  },
  activeWorkoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  activeWorkoutContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activeWorkoutText: {
    gap: 2,
  },
  activeWorkoutTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  activeWorkoutSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 12,
    marginBottom: 24,
    gap: 8,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  statsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 14,
    marginTop: 4,
  },
  recentSection: {
    flex: 1,
  },
  emptyCard: {
    padding: 32,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 14,
  },
  workoutsList: {
    gap: 12,
  },
  workoutCard: {
    padding: 16,
    borderRadius: 12,
  },
  workoutCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  workoutDate: {
    fontSize: 16,
    fontWeight: '600',
  },
  syncBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  syncBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  workoutStats: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  workoutStat: {
    flex: 1,
  },
  workoutStatValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  workoutStatLabel: {
    fontSize: 12,
  },
  exercisePreview: {
    fontSize: 13,
  },
});
