import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { getWorkoutById } from '@/db/queries';
import type { Workout } from '@/types';
import { formatDate, formatDuration } from '@/utils/date';

export default function WorkoutDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [workout, setWorkout] = useState<Workout | null>(null);

  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  useEffect(() => {
    if (typeof id === 'string') {
      getWorkoutById(id).then(setWorkout).catch(console.error);
    }
  }, [id]);

  const totalVolume = useMemo(() => {
    if (!workout) return 0;
    return workout.exercises.reduce(
      (acc, ex) => acc + ex.sets.reduce((sAcc, set) => sAcc + (set.weight ?? 0) * (set.reps ?? 0), 0),
      0
    );
  }, [workout]);

  if (!workout) return null;

  return (
    <>
      <Stack.Screen 
        options={{
          headerTitle: 'Workout Detail',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          headerShadowVisible: false,
        }} 
      />
      <ScrollView 
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.header}>
          <Text style={[styles.dateText, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.metaPill, { backgroundColor: c.surfaceElevated }]}>
              <FontAwesome name="clock-o" size={12} color={c.textSecondary} />
              <Text style={[styles.metaText, { color: c.text }]}>
                {formatDuration(workout.startedAt, workout.endedAt)}
              </Text>
            </View>
            <View style={[styles.metaPill, { backgroundColor: c.surfaceElevated }]}>
              <FontAwesome name="bolt" size={12} color={c.warning || '#FF9F0A'} />
              <Text style={[styles.metaText, { color: c.text }]}>
                {(totalVolume / 1000).toFixed(1)}k kg Volume
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.exercisesList}>
          {workout.exercises.map((ex, index) => (
            <View key={ex.id} style={[styles.exerciseCard, { backgroundColor: c.surface, borderColor: c.border }]}>
              <View style={styles.exHeader}>
                <Text style={[styles.exIndex, { color: c.textTertiary }]}>{index + 1}</Text>
                <Text style={[styles.exName, { color: c.text }]}>{ex.name}</Text>
              </View>

              {ex.notes && (
                <View style={[styles.notesBox, { backgroundColor: c.accentSoft }]}>
                  <FontAwesome name="sticky-note-o" size={12} color={c.accent} />
                  <Text style={[styles.notesText, { color: c.accent }]}>{ex.notes}</Text>
                </View>
              )}

              <View style={styles.tableHeader}>
                <Text style={[styles.thText, { flex: 1, color: c.textSecondary }]}>SET</Text>
                <Text style={[styles.thText, { flex: 2, textAlign: 'center', color: c.textSecondary }]}>+KG</Text>
                <Text style={[styles.thText, { flex: 2, textAlign: 'center', color: c.textSecondary }]}>REPS</Text>
                <View style={{ width: 24 }} />
              </View>

              {ex.sets.map((set, sIndex) => {
                let badgeText = sIndex + 1 + '';
                let badgeColor = c.surfaceElevated;
                let badgeTextColor = c.text;

                if (set.isWarmup) { badgeText = 'W'; badgeColor = c.warmupSoft; badgeTextColor = c.warmup; }
                if (set.isDropset) { badgeText = 'D'; badgeColor = c.dropSetSoft; badgeTextColor = c.dropSet; }
                if (set.isFailure) { badgeText = 'F'; badgeColor = c.dangerSoft; badgeTextColor = c.danger; }

                return (
                  <View key={set.id} style={[styles.setRow, { borderTopColor: c.border }]}>
                    <View style={{ flex: 1, alignItems: 'flex-start' }}>
                      <View style={[styles.setBadge, { backgroundColor: badgeColor }]}>
                        <Text style={[styles.setBadgeText, { color: badgeTextColor }]}>{badgeText}</Text>
                      </View>
                    </View>
                    <Text style={[styles.setValue, { flex: 2, color: c.text }]}>{set.weight || '-'}</Text>
                    <Text style={[styles.setValue, { flex: 2, color: c.text }]}>{set.reps || '-'}</Text>
                    <FontAwesome name="check-circle" size={18} color={set.isCompleted ? c.success : c.textTertiary} style={{ width: 24 }} />
                  </View>
                );
              })}
            </View>
          ))}
        </View>

      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.surface, borderTopColor: c.border }]}>
        <TouchableOpacity 
          style={[styles.repeatBtn, { backgroundColor: c.accent }]}
          onPress={() => {
            Alert.alert(
              'Repeat Workout', 
              'This will start a new workout with these exercises.', 
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Start', style: 'default' }]
            );
          }}
          activeOpacity={0.8}
        >
          <FontAwesome name="repeat" size={16} color="#fff" />
          <Text style={styles.repeatBtnText}>Repeat Workout</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  header: { marginBottom: 24, paddingHorizontal: 8 },
  dateText: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  metaRow: { flexDirection: 'row', gap: 12 },
  metaPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, gap: 8 },
  metaText: { fontSize: 13, fontWeight: '700' },
  exercisesList: { gap: 16 },
  exerciseCard: { borderRadius: 24, borderWidth: 1, padding: 16, overflow: 'hidden' },
  exHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  exIndex: { fontSize: 16, fontWeight: '800' },
  exName: { fontSize: 18, fontWeight: '700', flex: 1 },
  notesBox: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, marginBottom: 16, gap: 8 },
  notesText: { fontSize: 13, fontWeight: '500', flex: 1 },
  tableHeader: { flexDirection: 'row', paddingHorizontal: 4, marginBottom: 8 },
  thText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  setRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: 10, paddingHorizontal: 4 },
  setBadge: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  setBadgeText: { fontSize: 12, fontWeight: '800' },
  setValue: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36, borderWidth: 1 },
  repeatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 16, gap: 8 },
  repeatBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
