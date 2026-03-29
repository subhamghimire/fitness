import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import type { Workout } from '@/types';
import { formatDate, formatDuration } from '@/utils/date';

interface Props {
  workout: Workout;
  onPress: () => void;
}

export function WorkoutListItem({ workout, onPress }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const totalSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const totalVolume = workout.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((sAcc, set) => sAcc + (set.weight ?? 0) * (set.reps ?? 0), 0),
    0
  );

  return (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]} 
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={[styles.date, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
          <Text style={[styles.duration, { color: c.textSecondary }]}>
            {formatDuration(workout.startedAt, workout.endedAt)}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={c.textTertiary} />
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.pill, { backgroundColor: c.surfaceElevated }]}>
          <FontAwesome name="list-ul" size={10} color={c.accent} />
          <Text style={[styles.pillText, { color: c.textSecondary }]}>{workout.exercises.length} Exercises</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: c.surfaceElevated }]}>
          <FontAwesome name="repeat" size={10} color={c.success} />
          <Text style={[styles.pillText, { color: c.textSecondary }]}>{totalSets} Sets</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: c.surfaceElevated }]}>
          <FontAwesome name="bolt" size={10} color={c.warning || '#FF9F0A'} />
          <Text style={[styles.pillText, { color: c.textSecondary }]}>{(totalVolume / 1000).toFixed(1)}k kg</Text>
        </View>
      </View>

      {workout.exercises.length > 0 && (
        <View style={[styles.exercisesRow, { borderTopColor: c.border }]}>
          {workout.exercises.slice(0, 3).map((ex) => (
            <Text key={ex.id} style={[styles.exerciseText, { color: c.text }]} numberOfLines={1}>
              • {ex.name}
            </Text>
          ))}
          {workout.exercises.length > 3 && (
            <Text style={[styles.exerciseText, { color: c.textTertiary }]}>
              + {workout.exercises.length - 3} more...
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  titleGroup: {},
  date: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  duration: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 6,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  exercisesRow: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 4,
  },
  exerciseText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
