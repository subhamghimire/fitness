import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SetRow } from './SetRow';
import type { Exercise, SetData } from '@/types';
interface Props { exercise: Exercise; onAddSet: () => void; onUpdateSet: (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void; onDeleteSet: (setId: string) => void; onToggleWarmup: (setId: string) => void; onDeleteExercise: () => void; isDark?: boolean; }
export function ExerciseCard({ exercise, onAddSet, onUpdateSet, onDeleteSet, onToggleWarmup, onDeleteExercise, isDark = false }: Props) {
  const cardBg = isDark ? '#1c1c1e' : '#fff'; const textColor = isDark ? '#fff' : '#000'; const borderColor = isDark ? '#3a3a3c' : '#e5e5ea';
  let n = 0;
  return (
    <View style={[styles.container, { backgroundColor: cardBg, borderColor }]}>
      <View style={styles.header}><Text style={[styles.name, { color: textColor }]}>{exercise.name}</Text><TouchableOpacity onPress={onDeleteExercise}><FontAwesome name="times" size={20} color="#ff3b30" /></TouchableOpacity></View>
      <View style={styles.cols}><Text style={[styles.col, styles.setCol, { color: textColor }]}>SET</Text><Text style={[styles.col, styles.valCol, { color: textColor }]}>KG</Text><Text style={[styles.col, styles.valCol, { color: textColor }]}>REPS</Text><Text style={[styles.col, styles.rpeCol, { color: textColor }]}>RPE</Text><View style={styles.actCol} /></View>
      <View style={styles.sets}>{exercise.sets.map(s => { if (!s.isWarmup) n++; return <SetRow key={s.id} set={s} setNumber={n} onUpdate={(d) => onUpdateSet(s.id, d)} onDelete={() => onDeleteSet(s.id)} onToggleWarmup={() => onToggleWarmup(s.id)} isDark={isDark} />; })}</View>
      <TouchableOpacity style={styles.addSet} onPress={onAddSet}><FontAwesome name="plus" size={14} color="#007AFF" /><Text style={styles.addSetText}>Add Set</Text></TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({ container: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 16 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e5ea' }, name: { fontSize: 18, fontWeight: '600', flex: 1 }, cols: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e5e5ea' }, col: { fontSize: 10, fontWeight: '600', textAlign: 'center', opacity: 0.6 }, setCol: { width: 44 }, valCol: { flex: 1 }, rpeCol: { width: 60 }, actCol: { width: 34 }, sets: { paddingVertical: 4 }, addSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#e5e5ea' }, addSetText: { fontSize: 14, fontWeight: '600', color: '#007AFF' } });
