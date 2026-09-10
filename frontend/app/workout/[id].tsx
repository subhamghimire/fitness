import React, { useEffect, useCallback, useRef } from 'react';
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
import { syncService } from '@/sync/sync.service';
import { workoutNotificationService } from '@/services/workoutNotification.service';
import { C } from '@/constants/Colors';
import type { SetData } from '@/types';

export default function ActiveWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);

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

  useEffect(() => {
    loadActiveWorkout();
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

  // Debounced notification updates — avoid thrashing on every keystroke
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
          try {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await workoutNotificationService.stop();
            await endWorkout();
            router.replace('/(tabs)');
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

  const handleExerciseHistory = useCallback(
    (exerciseId: string, name: string) => {
      router.push({ pathname: '/workout/exercise-history', params: { exerciseId, name } });
    },
    [router]
  );

  const handleReplaceExercise = useCallback(
    (exerciseId: string, name: string) => {
      router.push({
        pathname: '/workout/exercise-picker',
        params: { replaceExerciseId: exerciseId, currentName: name },
      });
    },
    [router]
  );

  const handleExerciseActions = useCallback(
    (exerciseId: string, name: string) => {
      Alert.alert(name, undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', onPress: () => handleReplaceExercise(exerciseId, name) },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeExercise(exerciseId),
        },
      ]);
    },
    [handleReplaceExercise, removeExercise]
  );

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

  // Instant paint when workout already in memory (e.g. navigating from home)
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
            <TouchableOpacity onPress={handleFinish} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.headerBtnText, { color: c.accent }]}>Finish</Text>
            </TouchableOpacity>
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

          {activeWorkout.exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              previousSets={previousSets[exercise.id]}
              onAddSet={() => {
                void Haptics.selectionAsync();
                void addSet(exercise.id);
              }}
              onUpdateSet={onUpdateSet}
              onDeleteSet={onDeleteSet}
              onCycleSetType={onCycleSetType}
              onUpdateNotes={(text) => void updateExercise(exercise.id, { notes: text })}
              onOpenExerciseMenu={() => handleExerciseActions(exercise.id, exercise.name)}
              onPressExerciseTitle={() => handleExerciseHistory(exercise.id, exercise.name)}
              isDark={isDark}
            />
          ))}

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

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  container: { flex: 1 },
  noWorkoutText: { fontSize: 17, fontWeight: '600' },
  backBtn: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerBtnText: { fontSize: 16, fontWeight: '600', paddingHorizontal: 4 },
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
