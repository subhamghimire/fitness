import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { C } from '@/constants/Colors';
import type { SetData } from '@/types';

interface Props {
  set: SetData;
  setNumber: number;
  onUpdate: (data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void;
  onDelete: () => void;
  onToggleWarmup: () => void;
  isDark?: boolean;
}

export function SetRow({ set, setNumber, onUpdate, onDelete, onToggleWarmup, isDark = false }: Props) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');

  const c = isDark ? C.dark : C.light;

  useEffect(() => {
    setWeight(set.weight?.toString() ?? '');
    setReps(set.reps?.toString() ?? '');
    setRpe(set.rpe?.toString() ?? '');
  }, [set.weight, set.reps, set.rpe]);

  const handleWeight = (v: string) => { setWeight(v); const n = v ? parseFloat(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ weight: n }); };
  const handleReps = (v: string) => { setReps(v); const n = v ? parseInt(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ reps: n }); };
  const handleRpe = (v: string) => { setRpe(v); const n = v ? parseInt(v) : null; if (v === '' || (!isNaN(n!) && n! >= 1 && n! <= 10)) onUpdate({ rpe: n }); };

  const isWarmup = set.isWarmup;
  const rowBg = isWarmup ? c.warningSoft : 'transparent';

  return (
    <View style={[styles.row, { backgroundColor: rowBg }]}>
      {/* Set badge */}
      <TouchableOpacity
        style={[styles.badge, { backgroundColor: isWarmup ? c.warning : c.accentSoft }]}
        onPress={onToggleWarmup}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Text style={[styles.badgeText, { color: isWarmup ? '#fff' : c.accent }]}>
          {isWarmup ? 'W' : setNumber}
        </Text>
      </TouchableOpacity>

      {/* Weight */}
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text }]}
          value={weight}
          onChangeText={handleWeight}
          placeholder="–"
          placeholderTextColor={c.textTertiary}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />
      </View>

      {/* Reps */}
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text }]}
          value={reps}
          onChangeText={handleReps}
          placeholder="–"
          placeholderTextColor={c.textTertiary}
          keyboardType="number-pad"
          selectTextOnFocus
        />
      </View>

      {/* RPE */}
      <View style={styles.rpeWrap}>
        <TextInput
          style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text }]}
          value={rpe}
          onChangeText={handleRpe}
          placeholder="–"
          placeholderTextColor={c.textTertiary}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
        />
      </View>

      {/* Delete */}
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <FontAwesome name="trash-o" size={15} color={c.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    gap: 8,
  },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  inputWrap: {
    flex: 1,
  },
  rpeWrap: {
    width: 50,
  },
  input: {
    height: 38,
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 30,
    alignItems: 'center',
  },
});
