import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SetRow } from './SetRow';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import type { Exercise, SetData } from '@/types';

interface Props {
  exercise: Exercise;
  previousSets?: SetData[];
  progressionHint?: string | null;
  restSeconds?: number;
  onAddSet: () => void;
  onUpdateSet: (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void;
  onDeleteSet: (setId: string) => void;
  onCycleSetType: (setId: string) => void;
  onOpenExerciseMenu: () => void;
  onPressExerciseTitle?: () => void;
  onUpdateNotes?: (notes: string) => void;
  onSetCompleted?: (setId: string) => void;
  isDark?: boolean;
}

function ExerciseCardComponent({
  exercise,
  previousSets,
  progressionHint,
  restSeconds = 90,
  onAddSet,
  onUpdateSet,
  onDeleteSet,
  onCycleSetType,
  onOpenExerciseMenu,
  onPressExerciseTitle,
  onUpdateNotes,
  onSetCompleted,
  isDark = false,
}: Props) {
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);
  let workingSetCount = 0;

  const [isNotesExpanded, setIsNotesExpanded] = React.useState(!!exercise.notes);
  const [notesText, setNotesText] = React.useState(exercise.notes ?? '');

  React.useEffect(() => {
    setNotesText(exercise.notes ?? '');
  }, [exercise.notes]);

  const toggleNotes = useCallback(() => setIsNotesExpanded((v) => !v), []);

  return (
    <View style={[styles.card, { backgroundColor: c.surface }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity activeOpacity={0.7} onPress={onPressExerciseTitle}>
            <Text style={[styles.exerciseName, { color: c.text }]} numberOfLines={2}>
              {exercise.name}
            </Text>
          </TouchableOpacity>
          {progressionHint ? (
            <Text style={[styles.hint, { color: c.textSecondary }]} numberOfLines={2}>
              {progressionHint}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={toggleNotes}
            style={styles.iconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name="document-text-outline"
              size={18}
              color={isNotesExpanded ? c.accent : c.textSecondary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onOpenExerciseMenu}
            style={styles.iconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {isNotesExpanded && (
        <View style={[styles.notesWrap, { backgroundColor: c.background }]}>
          <TextInput
            style={[styles.notesInput, { color: c.text }]}
            placeholder="Notes…"
            placeholderTextColor={c.textTertiary}
            multiline
            value={notesText}
            onChangeText={setNotesText}
            onBlur={() => onUpdateNotes?.(notesText)}
          />
        </View>
      )}

      <View style={styles.colHeaders}>
        <Text style={[styles.colLabel, styles.colSet, { color: c.textTertiary }]}>SET</Text>
        <Text style={[styles.colLabel, styles.colPrev, { color: c.textTertiary }]}>PREV</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>{unit.toUpperCase()}</Text>
        <Text style={[styles.colLabel, styles.colVal, { color: c.textTertiary }]}>REPS</Text>
        <Text style={[styles.colLabel, styles.colActLabel, { color: c.textTertiary }]}>✓</Text>
      </View>

      <View style={styles.sets}>
        {exercise.sets.map((s) => {
          const isWorking = !s.isWarmup && !s.isDropset && !s.isFailure;
          if (isWorking) workingSetCount++;
          const prevWorking = (previousSets ?? []).filter((p) => !p.isWarmup);
          const prevSet = isWorking ? prevWorking[workingSetCount - 1] : undefined;
          return (
            <SetRow
              key={s.id}
              set={s}
              setNumber={isWorking ? workingSetCount : 0}
              previousSet={prevSet}
              restSeconds={restSeconds}
              onUpdate={(d) => {
                onUpdateSet(s.id, d);
                if (d.isCompleted === true) onSetCompleted?.(s.id);
              }}
              onDelete={() => onDeleteSet(s.id)}
              onCycleSetType={() => onCycleSetType(s.id)}
              isDark={isDark}
            />
          );
        })}
      </View>

      <TouchableOpacity style={styles.addSetBtn} onPress={onAddSet} activeOpacity={0.65}>
        <Text style={[styles.addSetText, { color: c.accent }]}>+ Add Set</Text>
      </TouchableOpacity>
    </View>
  );
}

export const ExerciseCard = memo(ExerciseCardComponent);

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    marginBottom: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 8,
  },
  exerciseName: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  hint: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notesWrap: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  notesInput: {
    fontSize: 14,
    fontWeight: '500',
    minHeight: 36,
  },
  colHeaders: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 2,
    alignItems: 'center',
  },
  colLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  colSet: { width: 30 },
  colPrev: { width: 64, marginLeft: 10 },
  colVal: { flex: 1, marginLeft: 10 },
  colActLabel: { width: 34, marginLeft: 10, textAlign: 'center' },
  sets: {
    paddingBottom: 4,
  },
  addSetBtn: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
    alignItems: 'center',
  },
  addSetText: {
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
  },
});
