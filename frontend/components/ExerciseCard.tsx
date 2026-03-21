import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SetRow } from './SetRow';
import { C } from '@/constants/Colors';
import type { Exercise, SetData } from '@/types';

interface Props {
  exercise: Exercise;
  onAddSet: () => void;
  onUpdateSet: (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void;
  onDeleteSet: (setId: string) => void;
  onToggleWarmup: (setId: string) => void;
  onDeleteExercise: () => void;
  isDark?: boolean;
}

export function ExerciseCard({
  exercise, onAddSet, onUpdateSet, onDeleteSet, onToggleWarmup, onDeleteExercise, isDark = false,
}: Props) {
  const c = isDark ? C.dark : C.light;
  let workingSetCount = 0;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.accentDot, { backgroundColor: c.accent }]} />
          <Text style={[styles.exerciseName, { color: c.text }]} numberOfLines={1}>
            {exercise.name}
          </Text>
        </View>
        <TouchableOpacity onPress={onDeleteExercise} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={[styles.deleteBtn, { backgroundColor: c.dangerSoft }]}>
          <FontAwesome name="times" size={14} color={c.danger} />
        </TouchableOpacity>
      </View>

      {/* Column Headers */}
      <View style={[styles.colHeaders, { borderColor: c.border }]}>
        <Text style={[styles.colLabel, styles.colSet, { color: c.textTertiary }]}>SET</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>KG</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>REPS</Text>
        <Text style={[styles.colLabel, styles.colRpe, { color: c.textTertiary }]}>RPE</Text>
        <View style={styles.colAct} />
      </View>

      {/* Sets */}
      <View style={styles.sets}>
        {exercise.sets.map((s) => {
          if (!s.isWarmup) workingSetCount++;
          return (
            <SetRow
              key={s.id}
              set={s}
              setNumber={workingSetCount}
              onUpdate={(d) => onUpdateSet(s.id, d)}
              onDelete={() => onDeleteSet(s.id)}
              onToggleWarmup={() => onToggleWarmup(s.id)}
              isDark={isDark}
            />
          );
        })}
      </View>

      {/* Add Set */}
      <TouchableOpacity
        style={[styles.addSetBtn, { borderColor: c.border, backgroundColor: c.accentSoft }]}
        onPress={onAddSet}
        activeOpacity={0.7}
      >
        <FontAwesome name="plus" size={12} color={c.accent} />
        <Text style={[styles.addSetText, { color: c.accent }]}>Add Set</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  accentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    letterSpacing: -0.2,
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colHeaders: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  colLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  colSet: { width: 44 },
  colVal: { flex: 1 },
  colRpe: { width: 56 },
  colAct: { width: 36 },
  sets: {
    paddingVertical: 4,
  },
  addSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    gap: 7,
    borderTopWidth: 1,
  },
  addSetText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
});
