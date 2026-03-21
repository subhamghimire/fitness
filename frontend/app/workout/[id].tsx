import React, { useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { ExerciseCard } from '@/components/ExerciseCard';
import { syncService } from '@/sync/sync.service';
import { C } from '@/constants/Colors';

export default function ActiveWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const { activeWorkout, isLoading, loadActiveWorkout, addSet, updateSet, removeSet, toggleWarmup, removeExercise, endWorkout, cancelWorkout } = useWorkoutStore();

  useEffect(() => { loadActiveWorkout(); }, []);

  const handleFinish = () => {
    if (!activeWorkout) return;
    if (activeWorkout.exercises.length === 0) {
      Alert.alert('Empty Workout', 'Add at least one exercise before finishing.', [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Finish Workout', 'Ready to save this workout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finish', onPress: async () => { await endWorkout(); syncService.triggerSync(); router.replace('/(tabs)'); } },
    ]);
  };

  const handleCancel = () => {
    Alert.alert('Cancel Workout', 'Discard this workout entirely?', [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => { await cancelWorkout(); router.replace('/(tabs)'); } },
    ]);
  };

  const handleDelete = (exerciseId: string, name: string) => {
    Alert.alert('Remove Exercise', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeExercise(exerciseId) },
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.accent} />
      </View>
    );
  }

  if (!activeWorkout) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <FontAwesome name="bolt" size={40} color={c.textTertiary} />
        <Text style={[styles.noWorkoutText, { color: c.text }]}>No active workout</Text>
        <TouchableOpacity style={[styles.backBtn, { backgroundColor: c.accent }]} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.backBtnText}>Go Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerStyle: { backgroundColor: c.surface },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.dangerSoft }]} onPress={handleCancel}>
              <Text style={[styles.headerBtnText, { color: c.danger }]}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerTitle: () => (
            <View style={styles.timerContainer}>
              <View style={styles.timerDot} />
              <WorkoutTimer startTime={activeWorkout.startedAt} textColor={c.text} fontSize={19} />
            </View>
          ),
          headerRight: () => (
            <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.accentSoft }]} onPress={handleFinish}>
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
          showsVerticalScrollIndicator={false}
        >
          {/* Exercise count */}
          <Text style={[styles.setCount, { color: c.textSecondary }]}>
            {activeWorkout.exercises.length} exercise{activeWorkout.exercises.length !== 1 ? 's' : ''}
          </Text>

          {activeWorkout.exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              onAddSet={() => addSet(exercise.id)}
              onUpdateSet={updateSet}
              onDeleteSet={removeSet}
              onToggleWarmup={toggleWarmup}
              onDeleteExercise={() => handleDelete(exercise.id, exercise.name)}
              isDark={isDark}
            />
          ))}

          {activeWorkout.exercises.length === 0 && (
            <View style={[styles.emptyExercise, { borderColor: c.border }]}>
              <FontAwesome name="plus-circle" size={40} color={c.textTertiary} />
              <Text style={[styles.emptyExerciseTitle, { color: c.text }]}>Add your first exercise</Text>
              <Text style={[styles.emptyExerciseBody, { color: c.textSecondary }]}>
                Tap the button below to search and add an exercise
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom Add Exercise bar */}
        <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.addExBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push('/workout/exercise-picker')}
            activeOpacity={0.85}
          >
            <FontAwesome name="plus" size={16} color="#fff" />
            <Text style={styles.addExText}>Add Exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  container: { flex: 1 },
  noWorkoutText: { fontSize: 18, fontWeight: '600' },
  backBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  headerBtnText: { fontSize: 14, fontWeight: '700' },
  timerContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#30D158' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 110 },
  setCount: { fontSize: 13, fontWeight: '600', marginBottom: 12, letterSpacing: 0.2 },
  emptyExercise: {
    alignItems: 'center', paddingVertical: 48, borderRadius: 16, borderWidth: 1,
    borderStyle: 'dashed', gap: 10, marginTop: 8,
  },
  emptyExerciseTitle: { fontSize: 17, fontWeight: '700' },
  emptyExerciseBody: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 34, paddingTop: 14, borderTopWidth: 1,
  },
  addExBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 14, gap: 10,
    shadowColor: '#6C63FF', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  addExText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
