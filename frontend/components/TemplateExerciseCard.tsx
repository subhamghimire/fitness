import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { TemplateSetRow } from './TemplateSetRow';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import type { TemplateExercise, TemplateSet } from '@/types';

interface Props {
  exercise: TemplateExercise;
  onAddSet: () => void;
  onUpdateSet: (setId: string, data: Partial<Omit<TemplateSet, 'id' | 'templateExerciseId'>>) => void;
  onDeleteSet: (setId: string) => void;
  onCycleSetType: (setId: string) => void;
  onDeleteExercise: () => void;
  isDark?: boolean;
}

export function TemplateExerciseCard({
  exercise, onAddSet, onUpdateSet, onDeleteSet, onCycleSetType, onDeleteExercise, isDark = false,
}: Props) {
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);
  let workingSetCount = 0;

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.exerciseName, { color: c.text }]} numberOfLines={2}>
            {exercise.name}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onDeleteExercise} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={20} color={c.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.colHeaders}>
        <Text style={[styles.colLabel, styles.colSet, { color: c.textTertiary }]}>SET</Text>
        <Text style={[styles.colLabel, styles.colPrev, { color: c.textTertiary }]}>PREVIOUS</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>{unit.toUpperCase()}</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>REPS</Text>
        <View style={styles.colAct} />
      </View>

      <View style={styles.sets}>
        {exercise.sets.map((s) => {
          const isWorking = !s.isWarmup && !s.isDropset && !s.isFailure;
          if (isWorking) workingSetCount++;
          return (
            <TemplateSetRow
              key={s.id}
              set={s}
              setNumber={isWorking ? workingSetCount : 0}
              onUpdate={(d: Partial<Omit<TemplateSet, 'id' | 'templateExerciseId'>>) => onUpdateSet(s.id, d)}
              onDelete={() => onDeleteSet(s.id)}
              onCycleSetType={() => onCycleSetType(s.id)}
              isDark={isDark}
            />
          );
        })}
      </View>

      <TouchableOpacity style={styles.addSetBtn} onPress={onAddSet} activeOpacity={0.6}>
        <View style={[styles.addSetContent, { backgroundColor: c.accentSoft }]}>
          <FontAwesome name="plus" size={13} color={c.accent} />
          <Text style={[styles.addSetText, { color: c.accent }]}>Add Set</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, marginBottom: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 14 },
  headerLeft: { flex: 1, paddingRight: 10 },
  exerciseName: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255, 69, 58, 0.1)' },
  colHeaders: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 4, marginBottom: 4 },
  colLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textAlign: 'center' },
  colSet: { width: 32 },
  colPrev: { width: 60, marginLeft: 12 },
  colVal: { flex: 1, marginLeft: 12 },
  colAct: { width: 34, marginLeft: 12 },
  sets: { paddingBottom: 8 },
  addSetBtn: { paddingHorizontal: 16, paddingBottom: 16 },
  addSetContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 12, gap: 8 },
  addSetText: { fontSize: 15, fontWeight: '700' },
});
