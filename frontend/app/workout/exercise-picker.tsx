import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

// Common exercises - can be expanded later
const COMMON_EXERCISES = [
  // Chest
  'Bench Press',
  'Incline Bench Press',
  'Decline Bench Press',
  'Dumbbell Press',
  'Dumbbell Fly',
  'Cable Fly',
  'Push Up',
  'Chest Dip',

  // Back
  'Deadlift',
  'Barbell Row',
  'Dumbbell Row',
  'Pull Up',
  'Chin Up',
  'Lat Pulldown',
  'Seated Cable Row',
  'T-Bar Row',

  // Shoulders
  'Overhead Press',
  'Military Press',
  'Dumbbell Shoulder Press',
  'Lateral Raise',
  'Front Raise',
  'Rear Delt Fly',
  'Face Pull',
  'Shrug',

  // Arms
  'Barbell Curl',
  'Dumbbell Curl',
  'Hammer Curl',
  'Preacher Curl',
  'Tricep Pushdown',
  'Tricep Extension',
  'Skull Crusher',
  'Close Grip Bench Press',

  // Legs
  'Squat',
  'Front Squat',
  'Leg Press',
  'Hack Squat',
  'Lunge',
  'Bulgarian Split Squat',
  'Romanian Deadlift',
  'Leg Curl',
  'Leg Extension',
  'Calf Raise',

  // Core
  'Plank',
  'Crunch',
  'Leg Raise',
  'Ab Wheel Rollout',
  'Cable Crunch',
  'Russian Twist',
];

export default function ExercisePickerScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [customExercise, setCustomExercise] = useState('');
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { addExercise, addSet } = useWorkoutStore();

  // Filter exercises based on search
  const filteredExercises = COMMON_EXERCISES.filter((exercise) =>
    exercise.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectExercise = async (name: string) => {
    try {
      // Add exercise and automatically add one set
      const exerciseId = await addExercise(name);
      await addSet(exerciseId);
      router.back();
    } catch (error) {
      Alert.alert('Error', 'Failed to add exercise');
    }
  };

  const handleAddCustomExercise = async () => {
    const name = customExercise.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter an exercise name');
      return;
    }
    await handleSelectExercise(name);
  };

  const renderExerciseItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      style={[
        styles.exerciseItem,
        { backgroundColor: isDark ? '#1c1c1e' : '#fff' },
      ]}
      onPress={() => handleSelectExercise(item)}
      activeOpacity={0.7}
    >
      <Text style={[styles.exerciseName, { color: colors.text }]}>{item}</Text>
      <FontAwesome name="plus" size={18} color={colors.tint} />
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Add Exercise',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: colors.tint, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View
            style={[
              styles.searchBar,
              { backgroundColor: isDark ? '#1c1c1e' : '#fff' },
            ]}
          >
            <FontAwesome
              name="search"
              size={16}
              color={isDark ? '#8e8e93' : '#c7c7cc'}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search exercises..."
              placeholderTextColor={isDark ? '#8e8e93' : '#c7c7cc'}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <FontAwesome
                  name="times-circle"
                  size={18}
                  color={isDark ? '#8e8e93' : '#c7c7cc'}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Custom Exercise Input */}
        <View style={styles.customSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Custom Exercise
          </Text>
          <View style={styles.customInputRow}>
            <TextInput
              style={[
                styles.customInput,
                { backgroundColor: isDark ? '#1c1c1e' : '#fff', color: colors.text },
              ]}
              placeholder="Enter exercise name"
              placeholderTextColor={isDark ? '#8e8e93' : '#c7c7cc'}
              value={customExercise}
              onChangeText={setCustomExercise}
              autoCapitalize="words"
            />
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.tint }]}
              onPress={handleAddCustomExercise}
            >
              <FontAwesome name="plus" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Exercise List */}
        <View style={styles.listSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Common Exercises
          </Text>
          <FlatList
            data={filteredExercises}
            keyExtractor={(item) => item}
            renderItem={renderExerciseItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} />
            )}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={[styles.emptyText, { color: colors.text, opacity: 0.6 }]}>
                  No exercises found
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  customSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    opacity: 0.6,
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  customInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listSection: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  exerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  exerciseName: {
    fontSize: 16,
  },
  separator: {
    height: 1,
    marginLeft: 16,
  },
  emptyList: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
  },
});
