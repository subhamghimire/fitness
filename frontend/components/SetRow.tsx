import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import type { SetData } from '@/types';
interface Props { set: SetData; setNumber: number; onUpdate: (data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void; onDelete: () => void; onToggleWarmup: () => void; isDark?: boolean; }
export function SetRow({ set, setNumber, onUpdate, onDelete, onToggleWarmup, isDark = false }: Props) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');
  useEffect(() => { setWeight(set.weight?.toString() ?? ''); setReps(set.reps?.toString() ?? ''); setRpe(set.rpe?.toString() ?? ''); }, [set.weight, set.reps, set.rpe]);
  const handleWeight = (v: string) => { setWeight(v); const n = v ? parseFloat(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ weight: n }); };
  const handleReps = (v: string) => { setReps(v); const n = v ? parseInt(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ reps: n }); };
  const handleRpe = (v: string) => { setRpe(v); const n = v ? parseInt(v) : null; if (v === '' || (!isNaN(n!) && n! >= 1 && n! <= 10)) onUpdate({ rpe: n }); };
  const inputBg = isDark ? '#2c2c2e' : '#f2f2f7'; const textColor = isDark ? '#fff' : '#000'; const labelColor = isDark ? '#8e8e93' : '#6e6e73';
  return (
    <View style={[styles.container, { backgroundColor: set.isWarmup ? (isDark ? '#3a3a3c' : '#e5e5ea') : 'transparent' }]}>
      <TouchableOpacity style={styles.setNum} onPress={onToggleWarmup}><Text style={[styles.setNumText, { color: labelColor }]}>{set.isWarmup ? 'W' : setNumber}</Text></TouchableOpacity>
      <View style={styles.inputGroup}><Text style={[styles.label, { color: labelColor }]}>kg</Text><TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={weight} onChangeText={handleWeight} placeholder="-" placeholderTextColor={labelColor} keyboardType="decimal-pad" selectTextOnFocus /></View>
      <View style={styles.inputGroup}><Text style={[styles.label, { color: labelColor }]}>reps</Text><TextInput style={[styles.input, { backgroundColor: inputBg, color: textColor }]} value={reps} onChangeText={handleReps} placeholder="-" placeholderTextColor={labelColor} keyboardType="number-pad" selectTextOnFocus /></View>
      <View style={styles.inputGroup}><Text style={[styles.label, { color: labelColor }]}>RPE</Text><TextInput style={[styles.input, styles.rpe, { backgroundColor: inputBg, color: textColor }]} value={rpe} onChangeText={handleRpe} placeholder="-" placeholderTextColor={labelColor} keyboardType="number-pad" maxLength={2} selectTextOnFocus /></View>
      <TouchableOpacity style={styles.del} onPress={onDelete}><FontAwesome name="trash-o" size={18} color="#ff3b30" /></TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({ container: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, gap: 8, borderRadius: 8 }, setNum: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, setNumText: { fontSize: 14, fontWeight: '600' }, inputGroup: { flex: 1, alignItems: 'center', gap: 4 }, label: { fontSize: 10, textTransform: 'uppercase' }, input: { width: '100%', height: 40, borderRadius: 8, textAlign: 'center', fontSize: 16, fontWeight: '500' }, rpe: { maxWidth: 60 }, del: { padding: 8 } });
