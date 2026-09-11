import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [history, setHistory] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    let alive = true;
    (async () => {
      try {
        if (typeof id !== 'string') {
          if (alive) setFailed(true);
          return;
        }
        const [w, all] = await Promise.all([
          WorkoutRepository.getById(id),
          WorkoutRepository.getHistory(200, 0),
        ]);
        if (!alive) return;
        if (!w) setFailed(true);
        else {
          setWorkout(w);
          setHistory(all);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
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
      {loading ? (
        <View style={[styles.center, { backgroundColor: c.background }]}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : failed || !summary ? (
        <View style={[styles.center, { backgroundColor: c.background }]}>
          <Text style={[styles.hero, { color: c.text }]}>Workout saved</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>Couldn’t load the summary.</Text>
          <TouchableOpacity
            style={[styles.primary, { backgroundColor: c.accent }]}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={[styles.container, { backgroundColor: c.background }]}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 40) }]}
        >
          <Text style={[styles.hero, { color: c.text }]}>Workout saved</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>Stored on this device</Text>

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

          {summary.prs.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: c.text }]}>Personal records</Text>
              {summary.prs.slice(0, 6).map((pr, i) => (
                <Text key={`${pr.kind}-${i}`} style={[styles.prLine, { color: c.textSecondary }]}>
                  {pr.exerciseName} — {pr.label}: {pr.valueLabel}
                </Text>
              ))}
            </View>
          )}

          {summary.highlights.map((h, i) => (
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
      )}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 8 },
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
    alignSelf: 'stretch',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  secondaryText: { fontSize: 14, fontWeight: '600' },
});
