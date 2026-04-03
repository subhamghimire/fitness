import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useWorkoutStore } from '@/store/workout.store';
import { useUnitStore } from '@/store/unit.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

export default function ExerciseHistoryScreen() {
  const { exerciseId, name } = useLocalSearchParams<{ exerciseId?: string | string[]; name?: string | string[] }>();
  const id = Array.isArray(exerciseId) ? exerciseId[0] : exerciseId;
  const title = Array.isArray(name) ? name[0] : name;
  const previousSets = useWorkoutStore((state) => (id ? state.previousSets[id] ?? [] : []));
  const unit = useUnitStore((state) => state.unit);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  return (
    <>
      <Stack.Screen
        options={{
          title: title ? `${title} History` : 'Exercise History',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitleStyle: { color: c.text, fontSize: 18, fontWeight: '800' },
        }}
      />

      <ScrollView style={[styles.container, { backgroundColor: c.background }]} contentContainerStyle={styles.content}>
        {previousSets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <FontAwesome name="clock-o" size={28} color={c.textTertiary} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>No history yet</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Complete this exercise in a workout to see previous sets here.
            </Text>
          </View>
        ) : (
          previousSets.map((set, index) => {
            const type = set.isWarmup ? 'WARMUP' : set.isDropset ? 'DROP' : set.isFailure ? 'FAIL' : 'WORK';
            const typeColor = set.isWarmup ? c.warmup : set.isDropset ? c.dropSet : set.isFailure ? c.danger : c.success;
            const typeBg = set.isWarmup ? c.warmupSoft : set.isDropset ? c.dropSetSoft : set.isFailure ? c.dangerSoft : c.successSoft;

            return (
              <View key={`${set.id}-${index}`} style={[styles.setCard, { backgroundColor: c.surface, borderColor: c.border }]}>
                <View style={styles.setRow}>
                  <Text style={[styles.setNumber, { color: c.text }]}>Set {index + 1}</Text>
                  <View style={[styles.typeBadge, { backgroundColor: typeBg }]}>
                    <Text style={[styles.typeBadgeText, { color: typeColor }]}>{type}</Text>
                  </View>
                </View>
                <Text style={[styles.setValue, { color: c.text }]}>
                  {set.weight ?? '-'} {unit} x {set.reps ?? '-'}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 26 },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800' },
  emptyBody: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  setCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 8,
  },
  setRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  setNumber: { fontSize: 16, fontWeight: '800' },
  setValue: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  typeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
