import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { summarizeWorkout, type WorkoutSummary } from '@/utils/prs';
import type { Workout } from '@/types';

export default function WorkoutSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((s) => s.unit);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    (async () => {
      if (typeof id !== 'string') return;
      const [w, all] = await Promise.all([
        WorkoutRepository.getById(id),
        WorkoutRepository.getHistory(200, 0),
      ]);
      setWorkout(w);
      setHistory(all);
    })();
  }, [id]);

  const summary: WorkoutSummary | null = useMemo(() => {
    if (!workout) return null;
    return summarizeWorkout(workout, history, unit);
  }, [workout, history, unit]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Workout complete',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerBackVisible: false,
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.hero, { color: c.text }]}>Nice work</Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>Saved on this device</Text>

        {summary && (
          <View style={[styles.stats, { backgroundColor: c.surface }]}>
            <Stat label="Exercises" value={String(summary.exerciseCount)} c={c} />
            <Stat label="Working sets" value={String(summary.workingSets)} c={c} />
            <Stat label="Volume" value={`${(summary.volume / 1000).toFixed(1)}k`} c={c} />
            <Stat
              label="vs last"
              value={
                summary.volumeDeltaPct == null
                  ? '—'
                  : `${summary.volumeDeltaPct > 0 ? '+' : ''}${summary.volumeDeltaPct}%`
              }
              c={c}
            />
          </View>
        )}

        {summary && summary.prs.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>Personal records</Text>
            {summary.prs.slice(0, 6).map((pr, i) => (
              <Text key={`${pr.kind}-${i}`} style={[styles.prLine, { color: c.textSecondary }]}>
                {pr.exerciseName} — {pr.label}: {pr.valueLabel}
              </Text>
            ))}
          </View>
        )}

        {summary?.highlights.map((h, i) => (
          <Text key={i} style={[styles.highlight, { color: c.accent }]}>
            {h}
          </Text>
        ))}

        <TouchableOpacity
          style={[styles.primary, { backgroundColor: c.accent }]}
          onPress={() => router.replace('/(tabs)')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>Done</Text>
        </TouchableOpacity>

        {workout && (
          <TouchableOpacity
            onPress={() => router.replace(`/workout/detail/${workout.id}`)}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, { color: c.textSecondary }]}>View details</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </>
  );
}

function Stat({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: (typeof C)['light'];
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  hero: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginTop: 8 },
  sub: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 14,
    padding: 12,
  },
  stat: { width: '50%', paddingVertical: 10, paddingHorizontal: 8 },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  section: { gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  prLine: { fontSize: 14, fontWeight: '500' },
  highlight: { fontSize: 14, fontWeight: '600' },
  primary: {
    marginTop: 20,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { fontSize: 14, fontWeight: '600' },
});
