import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { getAllWorkouts } from '@/db/queries';
import { useColorScheme } from '@/components/useColorScheme';
import { formatDate, formatDuration } from '@/utils/date';
import Colors from '@/constants/Colors';
import type { Workout } from '@/types';

export default function HistoryScreen() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const loadWorkouts = async () => {
    try {
      const data = await getAllWorkouts();
      setWorkouts(data);
    } catch (error) {
      console.error('Failed to load workouts:', error);
    }
  };

  // Reload when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadWorkouts();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadWorkouts();
    setRefreshing(false);
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

  const renderWorkoutItem = ({ item: workout }: { item: Workout }) => (
    <View
      style={[styles.workoutCard, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}
    >
      {/* Header */}
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.workoutDate, { color: colors.text }]}>
            {formatDate(workout.startedAt)}
          </Text>
          <Text style={[styles.workoutDuration, { color: colors.text, opacity: 0.6 }]}>
            {formatDuration(workout.startedAt, workout.endedAt)}
          </Text>
        </View>
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
          <FontAwesome
            name={workout.status === 'synced' ? 'cloud' : 'mobile'}
            size={12}
            color={workout.status === 'synced' ? '#fff' : colors.text}
          />
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

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {workout.exercises.length}
          </Text>
          <Text style={[styles.statLabel, { color: colors.text, opacity: 0.6 }]}>
            Exercises
          </Text>
        </View>
        <View style={[styles.stat, styles.statBorder, { borderColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {getTotalSets(workout)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.text, opacity: 0.6 }]}>
            Sets
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.text }]}>
            {(getTotalVolume(workout) / 1000).toFixed(1)}k
          </Text>
          <Text style={[styles.statLabel, { color: colors.text, opacity: 0.6 }]}>
            Volume (kg)
          </Text>
        </View>
      </View>

      {/* Exercise List */}
      <View style={[styles.exerciseList, { borderTopColor: isDark ? '#3a3a3c' : '#e5e5ea' }]}>
        {workout.exercises.map((exercise, index) => (
          <View key={exercise.id} style={styles.exerciseRow}>
            <Text style={[styles.exerciseName, { color: colors.text }]}>
              {exercise.name}
            </Text>
            <Text style={[styles.exerciseSets, { color: colors.text, opacity: 0.6 }]}>
              {exercise.sets.length} sets
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <FontAwesome
        name="calendar-o"
        size={64}
        color={isDark ? '#3a3a3c' : '#c7c7cc'}
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No Workout History
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.text, opacity: 0.6 }]}>
        Complete your first workout to see it here
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}>
      <FlatList
        data={workouts}
        keyExtractor={(item) => item.id}
        renderItem={renderWorkoutItem}
        contentContainerStyle={[
          styles.listContent,
          workouts.length === 0 && styles.emptyListContent,
        ]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={EmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.tint}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flex: 1,
    justifyContent: 'center',
  },
  separator: {
    height: 12,
  },
  workoutCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
  },
  workoutDate: {
    fontSize: 18,
    fontWeight: '600',
  },
  workoutDuration: {
    fontSize: 14,
    marginTop: 2,
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  syncBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  exerciseList: {
    borderTopWidth: 1,
    paddingVertical: 8,
  },
  exerciseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  exerciseName: {
    fontSize: 14,
    flex: 1,
  },
  exerciseSets: {
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
});
