import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import type { Workout } from '@/types';
import { formatDate, formatDuration } from '@/utils/date';

interface Props {
  workout: Workout;
  onPress: () => void;
}

function WorkoutListItemComponent({ workout, onPress }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);

  const totalSets = workout.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const totalVolume = workout.exercises.reduce(
    (acc, ex) => acc + ex.sets.reduce((sAcc, set) => sAcc + (set.weight ?? 0) * (set.reps ?? 0), 0),
    0
  );

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: c.border }]}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.65}
    >
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={[styles.date, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
          <Text style={[styles.meta, { color: c.textSecondary }]}>
            {formatDuration(workout.startedAt, workout.endedAt)} · {workout.exercises.length} exercises ·{' '}
            {totalSets} sets · {(totalVolume / 1000).toFixed(1)}k {unit}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={11} color={c.textTertiary} />
      </View>

      {workout.exercises.length > 0 && (
        <Text style={[styles.exerciseText, { color: c.textTertiary }]} numberOfLines={1}>
          {workout.exercises
            .slice(0, 4)
            .map((ex) => ex.name)
            .join(' · ')}
          {workout.exercises.length > 4 ? ` +${workout.exercises.length - 4}` : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export const WorkoutListItem = memo(WorkoutListItemComponent);

const styles = StyleSheet.create({
  row: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleGroup: { flex: 1, paddingRight: 8 },
  date: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
  },
  exerciseText: {
    fontSize: 13,
    fontWeight: '400',
  },
});
