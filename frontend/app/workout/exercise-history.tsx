import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useUnitStore } from '@/store/unit.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { ProgressChart } from '@/components/history/ProgressChart';
import {
  filterWorkoutsByRange,
  getExerciseSessionHistory,
  getRichExercisePRs,
  estimate1RM,
} from '@/utils/prs';
import { suggestProgression } from '@/utils/progression';
import { usePreferencesStore } from '@/store/preferences.store';
import { formatDate } from '@/utils/date';
import type { Workout } from '@/types';

type Range = '7D' | '30D' | '3M' | '6M' | '1Y' | 'ALL';
const RANGES: Range[] = ['7D', '30D', '3M', '6M', '1Y', 'ALL'];

export default function ExerciseHistoryScreen() {
  const { name } = useLocalSearchParams<{ exerciseId?: string | string[]; name?: string | string[] }>();
  const title = Array.isArray(name) ? name[0] : name;
  const unit = useUnitStore((state) => state.unit);
  const progressionStyle = usePreferencesStore((s) => s.progressionStyle);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('3M');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await WorkoutRepository.getHistory(500, 0);
        if (alive) setWorkouts(all);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => filterWorkoutsByRange(workouts, range), [workouts, range]);
  const sessions = useMemo(
    () => (title ? getExerciseSessionHistory(filtered, title) : []),
    [filtered, title]
  );
  const prs = useMemo(() => getRichExercisePRs(filtered), [filtered]);
  const pr = title ? prs[title.trim().toLowerCase()] : undefined;

  const chartData = useMemo(
    () =>
      [...sessions]
        .reverse()
        .slice(-12)
        .map((s) => ({
          label: new Date(s.startedAt).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
          value: s.maxWeight,
        })),
    [sessions]
  );

  const suggestion = useMemo(() => {
    if (sessions.length === 0 || progressionStyle === 'manual') return null;
    return suggestProgression(sessions[0].sets, progressionStyle);
  }, [sessions, progressionStyle]);

  const onSelectRange = useCallback((r: Range) => setRange(r), []);

  return (
    <>
      <Stack.Screen
        options={{
          title: title ?? 'Exercise History',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '700' },
        }}
      />

      {loading ? (
        <View style={[styles.center, { backgroundColor: c.background }]}>
          <ActivityIndicator color={c.accent} />
        </View>
      ) : (
        <ScrollView
          style={[styles.container, { backgroundColor: c.background }]}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeRow}>
            {RANGES.map((r) => {
              const active = range === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.rangeChip, { backgroundColor: active ? c.accent : c.surface }]}
                  onPress={() => onSelectRange(r)}
                >
                  <Text style={[styles.rangeText, { color: active ? '#fff' : c.textSecondary }]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {pr && (
            <View style={[styles.prBlock, { backgroundColor: c.surface }]}>
              <Text style={[styles.blockTitle, { color: c.textSecondary }]}>Records</Text>
              <View style={styles.prGrid}>
                <PRStat label="Heaviest" value={`${pr.maxWeight || '–'} ${unit}`} c={c} />
                <PRStat label="Est. 1RM" value={`${pr.estimated1RM ? Math.round(pr.estimated1RM) : '–'} ${unit}`} c={c} />
                <PRStat label="Best set" value={pr.maxSetVolume ? `${Math.round(pr.maxSetVolume)}` : '–'} c={c} />
                <PRStat label="Session vol" value={pr.maxSessionVolume ? `${Math.round(pr.maxSessionVolume)}` : '–'} c={c} />
              </View>
            </View>
          )}

          {suggestion && (
            <View style={[styles.suggestBlock, { backgroundColor: c.accentSoft }]}>
              <Text style={[styles.suggestLabel, { color: c.accent }]}>Next target</Text>
              <Text style={[styles.suggestSummary, { color: c.text }]}>{suggestion.summary}</Text>
              <Text style={[styles.suggestDetail, { color: c.textSecondary }]}>{suggestion.detail}</Text>
            </View>
          )}

          {chartData.length >= 2 && (
            <View style={[styles.chartBlock, { backgroundColor: c.surface }]}>
              <Text style={[styles.blockTitle, { color: c.textSecondary }]}>Max weight trend</Text>
              <ProgressChart data={chartData} colorHex={c.accent} />
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: c.text }]}>Sessions</Text>

          {sessions.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No history yet</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                Complete this exercise in a workout to build history.
              </Text>
            </View>
          ) : (
            sessions.map((session) => (
              <View key={session.workoutId} style={[styles.session, { borderBottomColor: c.border }]}>
                <View style={styles.sessionHead}>
                  <Text style={[styles.sessionDate, { color: c.text }]}>{formatDate(session.startedAt)}</Text>
                  <Text style={[styles.sessionMeta, { color: c.textSecondary }]}>
                    {session.maxWeight} {unit} · {Math.round(session.volume)} vol
                    {session.e1rm > 0 ? ` · ~${Math.round(session.e1rm)} 1RM` : ''}
                  </Text>
                </View>
                {session.sets
                  .filter((s) => !s.isWarmup)
                  .map((s, i) => (
                    <Text key={s.id} style={[styles.setLine, { color: c.textSecondary }]}>
                      {i + 1}. {s.weight ?? '–'} × {s.reps ?? '–'}
                      {s.isDropset ? ' D' : ''}
                      {s.isFailure ? ' F' : ''}
                      {s.weight && s.reps ? `  (~${Math.round(estimate1RM(s.weight, s.reps))} 1RM)` : ''}
                    </Text>
                  ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </>
  );
}

function PRStat({
  label,
  value,
  c,
}: {
  label: string;
  value: string;
  c: (typeof C)['light'];
}) {
  return (
    <View style={styles.prStat}>
      <Text style={[styles.prValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.prLabel, { color: c.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 14, paddingBottom: 36, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  rangeRow: { gap: 8, paddingVertical: 4 },
  rangeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  rangeText: { fontSize: 12, fontWeight: '700' },
  prBlock: { borderRadius: 12, padding: 14, gap: 10 },
  blockTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  prGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  prStat: { width: '50%', paddingVertical: 6 },
  prValue: { fontSize: 16, fontWeight: '700' },
  prLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  suggestBlock: { borderRadius: 12, padding: 14, gap: 4 },
  suggestLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  suggestSummary: { fontSize: 16, fontWeight: '700' },
  suggestDetail: { fontSize: 13, fontWeight: '500', lineHeight: 18 },
  chartBlock: { borderRadius: 12, paddingVertical: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  empty: { paddingVertical: 28, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 14, textAlign: 'center' },
  session: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  sessionHead: { marginBottom: 4 },
  sessionDate: { fontSize: 15, fontWeight: '600' },
  sessionMeta: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  setLine: { fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
