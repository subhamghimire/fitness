import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { GroupedRow } from '@/components/ui/GroupedRow';
import { GroupedSection } from '@/components/ui/GroupedSection';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { TemplateRepository } from '@/repositories/template.repository';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { useAuthStore } from '@/store/auth.store';
import { useWorkoutStore } from '@/store/workout.store';
import type { Template, Workout } from '@/types';
import { formatDate, formatDuration } from '@/utils/date';
import { getWeeklySummary } from '@/utils/prs';

export default function HomeScreen() {
  const [recentWorkouts, setRecentWorkouts] = useState<Workout[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const activeWorkout = useWorkoutStore((s) => s.activeWorkout);
  const startWorkout = useWorkoutStore((s) => s.startWorkout);
  const startFromTemplateStore = useWorkoutStore((s) => s.startFromTemplate);
  const loadActiveWorkout = useWorkoutStore((s) => s.loadActiveWorkout);
  const user = useAuthStore((s) => s.user);

  useFocusEffect(
    useCallback(() => {
      void loadActiveWorkout();
      void loadHome();
    }, [loadActiveWorkout])
  );

  const loadHome = async () => {
    try {
      const [workouts, tpls] = await Promise.all([
        WorkoutRepository.getHistory(40, 0),
        TemplateRepository.getAll(),
      ]);
      setRecentWorkouts(workouts.slice(0, 5));
      setTemplates(tpls.slice(0, 8));
    } catch {
      // keep last good data
    }
  };

  const handleStartWorkout = async () => {
    try {
      const workoutId = await startWorkout();
      router.push(`/workout/${workoutId}`);
    } catch {
      Alert.alert('Error', 'Failed to start workout');
    }
  };

  const startFromTemplate = async (t: Template) => {
    if (activeWorkout) {
      Alert.alert('Workout in progress', 'Finish or discard your current workout first.');
      return;
    }
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const id = await startFromTemplateStore(t);
      router.push(`/workout/${id}`);
    } catch {
      Alert.alert('Error', 'Could not start from template');
    }
  };

  const getTotalSets = (w: Workout) => w.exercises.reduce((s, ex) => s + ex.sets.length, 0);
  const weekSummary = getWeeklySummary(recentWorkouts);
  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'there';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.kicker, { color: c.textSecondary }]}>Quick Start</Text>
      <Text style={[styles.hello, { color: c.text }]} numberOfLines={1}>
        {displayName}
      </Text>

      {activeWorkout ? (
        <TouchableOpacity
          style={[styles.active, { backgroundColor: c.surface }]}
          onPress={() => router.push(`/workout/${activeWorkout.id}`)}
          activeOpacity={0.75}
        >
          <View style={styles.activeLeft}>
            <View style={[styles.liveDot, { backgroundColor: c.success }]} />
            <View>
              <Text style={[styles.activeTitle, { color: c.text }]}>In progress</Text>
              <WorkoutTimer startTime={activeWorkout.startedAt} textColor={c.textSecondary} fontSize={13} />
            </View>
          </View>
          <Text style={[styles.activeCta, { color: c.accent }]}>Continue</Text>
        </TouchableOpacity>
      ) : (
        <PrimaryButton label="Start Empty Workout" onPress={handleStartWorkout} />
      )}

      <View style={styles.week}>
        <View style={styles.weekCell}>
          <Text style={[styles.weekValue, { color: c.text }]}>{weekSummary.workouts}</Text>
          <Text style={[styles.weekLabel, { color: c.textSecondary }]}>This week</Text>
        </View>
        <View style={[styles.weekRule, { backgroundColor: c.border }]} />
        <View style={styles.weekCell}>
          <Text style={[styles.weekValue, { color: c.text }]}>{weekSummary.workingSets}</Text>
          <Text style={[styles.weekLabel, { color: c.textSecondary }]}>Sets</Text>
        </View>
        <View style={[styles.weekRule, { backgroundColor: c.border }]} />
        <View style={styles.weekCell}>
          <Text style={[styles.weekValue, { color: c.text }]}>
            {(weekSummary.volume / 1000).toFixed(1)}k
          </Text>
          <Text style={[styles.weekLabel, { color: c.textSecondary }]}>Volume</Text>
        </View>
      </View>

      {templates.length > 0 ? (
        <GroupedSection title="Templates" style={styles.flushSection}>
          {templates.map((t, i) => (
            <GroupedRow
              key={t.id}
              label={t.name}
              value={`${t.exercises.length}`}
              last={i === templates.length - 1}
              onPress={() => startFromTemplate(t)}
            />
          ))}
        </GroupedSection>
      ) : (
        <GroupedSection
          title="Templates"
          footer="Save a routine once. Start it in one tap next time."
          style={styles.flushSection}
        >
          <GroupedRow label="Create a template" last onPress={() => router.push('/template/new')} />
        </GroupedSection>
      )}

      <View style={styles.recentBlock}>
        <Text style={[styles.recentTitle, { color: c.textSecondary }]}>RECENT</Text>
        {recentWorkouts.length === 0 ? (
          <Text style={[styles.empty, { color: c.textTertiary }]}>No workouts yet</Text>
        ) : (
          recentWorkouts.map((workout) => (
            <TouchableOpacity
              key={workout.id}
              style={[styles.recentRow, { borderBottomColor: c.border }]}
              onPress={() => router.push(`/workout/detail/${workout.id}`)}
              activeOpacity={0.65}
            >
              <View style={styles.recentHead}>
                <Text style={[styles.recentDate, { color: c.text }]}>{formatDate(workout.startedAt)}</Text>
                <Ionicons name="chevron-forward" size={14} color={c.textTertiary} />
              </View>
              <Text style={[styles.recentMeta, { color: c.textSecondary }]}>
                {workout.exercises.length} exercises · {getTotalSets(workout)} sets ·{' '}
                {formatDuration(workout.startedAt, workout.endedAt)}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 18 },
  kicker: { fontSize: 13, fontWeight: '400' },
  hello: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37, marginTop: -10 },
  active: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  activeTitle: { fontSize: 17, fontWeight: '600' },
  activeCta: { fontSize: 17, fontWeight: '600' },
  week: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  weekCell: { flex: 1, alignItems: 'center' },
  weekRule: { width: StyleSheet.hairlineWidth, height: 28 },
  weekValue: { fontSize: 22, fontWeight: '600', letterSpacing: 0.3 },
  weekLabel: { fontSize: 12, marginTop: 2 },
  flushSection: { paddingHorizontal: 0 },
  recentBlock: { paddingHorizontal: 4 },
  recentTitle: { fontSize: 13, marginBottom: 4, marginLeft: 4 },
  empty: { paddingVertical: 20, textAlign: 'center', fontSize: 15 },
  recentRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recentDate: { fontSize: 17, fontWeight: '600' },
  recentMeta: { fontSize: 13 },
});
