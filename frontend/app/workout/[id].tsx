import React, { useEffect } from 'react';
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
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import { WorkoutTimer } from '@/components/WorkoutTimer';
import { ExerciseCard } from '@/components/ExerciseCard';
import { syncService } from '@/sync/sync.service';
import Colors from '@/constants/Colors';

export default function ActiveWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const {
    activeWorkout,
    isLoading,
    loadActiveWorkout,
    addSet,
    updateSet,
    removeSet,
    toggleWarmup,
    removeExercise,
    endWorkout,
    cancelWorkout,
  } = useWorkoutStore();

  useEffect(() => {
    loadActiveWorkout();
  }, []);

  const handleFinishWorkout = () => {
    if (!activeWorkout) return;

    // Check if workout has any exercises
    if (activeWorkout.exercises.length === 0) {
      Alert.alert(
        'Empty Workout',
        'Add at least one exercise before finishing.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Finish Workout',
      'Are you sure you want to finish this workout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: async () => {
            await endWorkout();
            // Trigger sync
            syncService.triggerSync();
            router.replace('/(tabs)');
          },
        },
      ]
    );
  };

  const handleCancelWorkout = () => {
    Alert.alert(
      'Cancel Workout',
      'Are you sure you want to cancel? This workout will be deleted.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            await cancelWorkout();
            router.replace('/(tabs)');
          },
        },
      ]
    );
  };

  const handleAddExercise = () => {
    router.push('/workout/exercise-picker');
  };

  const handleDeleteExercise = (exerciseId: string, exerciseName: string) => {
    Alert.alert(
      'Remove Exercise',
      `Remove "${exerciseName}" from this workout?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeExercise(exerciseId),
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!activeWorkout) {
    return (
      <View style={[styles.emptyContainer, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}>
        <Text style={[styles.emptyText, { color: colors.text }]}>
          No active workout found
        </Text>
        <TouchableOpacity
          style={[styles.goBackButton, { backgroundColor: colors.tint }]}
          onPress={() => router.replace('/(tabs)')}
        >
          <Text style={styles.goBackButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Workout',
          headerLeft: () => (
            <TouchableOpacity onPress={handleCancelWorkout}>
              <Text style={{ color: '#ff3b30', fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={handleFinishWorkout}>
              <Text style={{ color: colors.tint, fontSize: 16, fontWeight: '600' }}>
                Finish
              </Text>
            </TouchableOpacity>
          ),
          headerTitle: () => (
            <WorkoutTimer
              startTime={activeWorkout.startedAt}
              textColor={colors.text}
            />
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Exercises */}
          {activeWorkout.exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              onAddSet={() => addSet(exercise.id)}
              onUpdateSet={updateSet}
              onDeleteSet={removeSet}
              onToggleWarmup={toggleWarmup}
              onDeleteExercise={() => handleDeleteExercise(exercise.id, exercise.name)}
              isDark={isDark}
            />
          ))}

          {/* Empty State */}
          {activeWorkout.exercises.length === 0 && (
            <View style={styles.emptyWorkout}>
              <FontAwesome
                name="plus-circle"
                size={48}
                color={isDark ? '#3a3a3c' : '#c7c7cc'}
              />
              <Text style={[styles.emptyWorkoutText, { color: colors.text, opacity: 0.6 }]}>
                Add your first exercise
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Add Exercise Button */}
        <View style={[styles.bottomBar, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}>
          <TouchableOpacity
            style={[styles.addExerciseButton, { backgroundColor: colors.tint }]}
            onPress={handleAddExercise}
            activeOpacity={0.8}
          >
            <FontAwesome name="plus" size={16} color="#fff" />
            <Text style={styles.addExerciseText}>Add Exercise</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 18,
    marginBottom: 16,
  },
  goBackButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  goBackButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyWorkout: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 16,
  },
  emptyWorkoutText: {
    fontSize: 16,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
    gap: 8,
  },
  addExerciseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
