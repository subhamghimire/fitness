import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useWorkoutStore } from '@/store/workout.store';
import { useUnitStore } from '@/store/unit.store';
import { useColorScheme } from '@/components/useColorScheme';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { ExerciseCard } from '@/components/ExerciseCard';
import { FloatingRestTimer } from '@/components/FloatingRestTimer';
import { PRToastProvider, usePRToast } from '@/components/PRToast';
import { syncService } from '@/sync/sync.service';
import { workoutNotificationService } from '@/services/workoutNotification.service';
import { C } from '@/constants/Colors';
import { suggestProgression, suggestedRestSeconds } from '@/utils/progression';
import { detectNewPRs } from '@/utils/prs';
import { WorkoutRepository } from '@/repositories/workout.repository';
import type { SetData, Workout } from '@/types';

function ActiveWorkoutInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);
  const { showPRs } = usePRToast();

  const activeWorkout = useWorkoutStore((s) => s.activeWorkout);
  const isLoading = useWorkoutStore((s) => s.isLoading);
  const previousSets = useWorkoutStore((s) => s.previousSets);
  const loadActiveWorkout = useWorkoutStore((s) => s.loadActiveWorkout);
  const addSet = useWorkoutStore((s) => s.addSet);
  const updateSet = useWorkoutStore((s) => s.updateSet);
  const removeSet = useWorkoutStore((s) => s.removeSet);
  const cycleSetType = useWorkoutStore((s) => s.cycleSetType);
  const removeExercise = useWorkoutStore((s) => s.removeExercise);
  const updateExercise = useWorkoutStore((s) => s.updateExercise);
  const endWorkout = useWorkoutStore((s) => s.endWorkout);
  const cancelWorkout = useWorkoutStore((s) => s.cancelWorkout);

  const notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<Workout[]>([]);

  useEffect(() => {
    loadActiveWorkout();
    WorkoutRepository.getHistory(150, 0)
      .then((h) => {
        historyRef.current = h;
      })
      .catch(() => undefined);
  }, [loadActiveWorkout]);

  useEffect(() => {
    if (!activeWorkout) {
      workoutNotificationService.stop().catch(() => undefined);
      return;
    }
    workoutNotificationService.start(activeWorkout, unit).catch(() => undefined);
    return () => {
      workoutNotificationService.stop().catch(() => undefined);
    };
  }, [activeWorkout?.id, unit]);

  useEffect(() => {
    if (!activeWorkout) return;
    if (notifyTimer.current) clearTimeout(notifyTimer.current);
    notifyTimer.current = setTimeout(() => {
      workoutNotificationService.update(activeWorkout, unit).catch(() => undefined);
    }, 800);
    return () => {
      if (notifyTimer.current) clearTimeout(notifyTimer.current);
    };
  }, [activeWorkout, unit]);

  const handleFinish = useCallback(() => {
    if (!activeWorkout) return;
    if (activeWorkout.exercises.length === 0) {
      Alert.alert('Empty Workout', 'Add at least one exercise before finishing.', [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Finish Workout', 'Save this workout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          const finishedId = activeWorkout.id;
          try {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await workoutNotificationService.stop();
            await endWorkout();
            router.replace(`/workout/summary/${finishedId}`);
            try {
              void syncService.maybeSync('workout_completed', true);
            } catch {
              /* noop */
            }
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : 'Please try again.';
            Alert.alert('Could not finish workout', message);
          }
        },
      },
    ]);
  }, [activeWorkout, endWorkout, router]);

  const handleCancel = useCallback(() => {
    Alert.alert('Cancel Workout', 'Discard this workout?', [
      { text: 'Keep Going', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try {
            await workoutNotificationService.stop();
            await cancelWorkout();
            router.replace('/(tabs)');
          } catch {
            Alert.alert('Could not discard workout', 'Please try again.');
          }
        },
      },
    ]);
  }, [cancelWorkout, router]);

  const onUpdateSet = useCallback(
    (setId: string, data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => {
      void updateSet(setId, data);
    },
    [updateSet]
  );

  const onDeleteSet = useCallback(
    (setId: string) => {
      void removeSet(setId);
    },
    [removeSet]
  );

  const onCycleSetType = useCallback(
    (setId: string) => {
      void cycleSetType(setId);
    },
    [cycleSetType]
  );

  const handleSetCompleted = useCallback(
    (exerciseId: string) => {
      const w = useWorkoutStore.getState().activeWorkout;
      if (!w) return;
      const ex = w.exercises.find((e) => e.id === exerciseId);
      if (!ex) return;
      // Defer PR check — never block set logging
      setTimeout(() => {
        const prs = detectNewPRs({
          exerciseName: ex.name,
          currentSets: ex.sets,
          history: historyRef.current,
          currentWorkoutId: w.id,
          unit,
        });
        if (prs.length > 0) showPRs(prs);
      }, 0);
    },
    [showPRs, unit]
  );

  const progressionHints = useMemo(() => {
    const map: Record<string, string> = {};
    if (!activeWorkout) return map;
    for (const ex of activeWorkout.exercises) {
      const prev = previousSets[ex.id];
      if (!prev?.length) continue;
      const s = suggestProgression(prev);
      if (s) map[ex.id] = s.summary;
    }
    return map;
  }, [activeWorkout, previousSets]);

  if (isLoading && !activeWorkout) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  if (!activeWorkout) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Text style={[styles.noWorkoutText, { color: c.text }]}>No active workout</Text>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: c.accent }]}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.backBtnText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerTitleAlign: 'center',
          title: '',
          headerStyle: { backgroundColor: c.surface },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={handleCancel} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.headerBtnText, { color: c.danger }]}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerTitle: () => (
            <View style={styles.timerContainer}>
              <View style={[styles.timerDot, { backgroundColor: c.success }]} />
              <WorkoutTimer startTime={activeWorkout.startedAt} textColor={c.text} fontSize={17} />
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerRight}>
              <TouchableOpacity
                onPress={() => router.push('/workout/plates')}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              >
                <FontAwesome name="circle-o" size={16} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleFinish} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={[styles.headerBtnText, { color: c.accent }]}>Finish</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.setCount, { color: c.textSecondary }]}>
            {activeWorkout.exercises.length} exercise{activeWorkout.exercises.length !== 1 ? 's' : ''}
          </Text>

          {activeWorkout.exercises.map((exercise) => {
            const rest =
              exercise.restSeconds ??
              suggestedRestSeconds(exercise.name);
            return (
              <ExerciseCard
                key={exercise.id}
                exercise={exercise}
                previousSets={previousSets[exercise.id]}
                progressionHint={progressionHints[exercise.id]}
                restSeconds={rest}
                onAddSet={() => {
                  void Haptics.selectionAsync();
                  void addSet(exercise.id);
                }}
                onUpdateSet={onUpdateSet}
                onDeleteSet={onDeleteSet}
                onCycleSetType={onCycleSetType}
                onUpdateNotes={(text) => void updateExercise(exercise.id, { notes: text })}
                onOpenExerciseMenu={() =>
                  Alert.alert(exercise.name, undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Replace',
                      onPress: () =>
                        router.push({
                          pathname: '/workout/exercise-picker',
                          params: { replaceExerciseId: exercise.id, currentName: exercise.name },
                        }),
                    },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => removeExercise(exercise.id),
                    },
                  ])
                }
                onPressExerciseTitle={() =>
                  router.push({
                    pathname: '/workout/exercise-history',
                    params: { exerciseId: exercise.id, name: exercise.name },
                  })
                }
                onSetCompleted={() => handleSetCompleted(exercise.id)}
                isDark={isDark}
              />
            );
          })}

          {activeWorkout.exercises.length === 0 && (
            <View style={styles.emptyExercise}>
              <Text style={[styles.emptyExerciseTitle, { color: c.text }]}>Add an exercise</Text>
              <Text style={[styles.emptyExerciseBody, { color: c.textSecondary }]}>
                Tap below to start logging sets
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.addExBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push('/workout/exercise-picker')}
            activeOpacity={0.8}
          >
            <FontAwesome name="plus" size={14} color="#fff" />
            <Text style={styles.addExText}>Add Exercise</Text>
          </TouchableOpacity>
        </View>

        <FloatingRestTimer />
      </View>
    </>
  );
}

export default function ActiveWorkoutScreen() {
  return (
    <PRToastProvider>
      <ActiveWorkoutInner />
    </PRToastProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  container: { flex: 1 },
  noWorkoutText: { fontSize: 17, fontWeight: '600' },
  backBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerBtnText: { fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timerContainer: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  timerDot: { width: 7, height: 7, borderRadius: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 108 },
  setCount: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  emptyExercise: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 6,
    marginTop: 8,
  },
  emptyExerciseTitle: { fontSize: 17, fontWeight: '700' },
  emptyExerciseBody: { fontSize: 14, textAlign: 'center', paddingHorizontal: 28 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 28,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addExBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    gap: 8,
  },
  addExText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
