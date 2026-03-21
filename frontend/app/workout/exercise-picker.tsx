import React, { useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Alert, SectionList,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

const CATEGORIES: { label: string; icon: string; exercises: string[] }[] = [
  { label: 'Chest', icon: '💪', exercises: ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Dumbbell Press', 'Dumbbell Fly', 'Cable Fly', 'Push Up', 'Chest Dip'] },
  { label: 'Back', icon: '🔙', exercises: ['Deadlift', 'Barbell Row', 'Dumbbell Row', 'Pull Up', 'Chin Up', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row'] },
  { label: 'Shoulders', icon: '🏋️', exercises: ['Overhead Press', 'Military Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly', 'Face Pull', 'Shrug'] },
  { label: 'Arms', icon: '💪', exercises: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Tricep Extension', 'Skull Crusher', 'Close Grip Bench Press'] },
  { label: 'Legs', icon: '🦵', exercises: ['Squat', 'Front Squat', 'Leg Press', 'Hack Squat', 'Lunge', 'Bulgarian Split Squat', 'Romanian Deadlift', 'Leg Curl', 'Leg Extension', 'Calf Raise'] },
  { label: 'Core', icon: '🎯', exercises: ['Plank', 'Crunch', 'Leg Raise', 'Ab Wheel Rollout', 'Cable Crunch', 'Russian Twist'] },
];

const ALL_EXERCISES = CATEGORIES.flatMap(c => c.exercises);

export default function ExercisePickerScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const { addExercise, addSet } = useWorkoutStore();

  const handleSelect = async (name: string) => {
    try { const id = await addExercise(name); await addSet(id); router.back(); }
    catch { Alert.alert('Error', 'Failed to add exercise'); }
  };

  const handleCustomAdd = async () => {
    const name = custom.trim();
    if (!name) { Alert.alert('Error', 'Enter an exercise name'); return; }
    await handleSelect(name);
  };

  // Filter logic
  let exercises: string[] = [];
  if (search.length > 0) {
    exercises = ALL_EXERCISES.filter(e => e.toLowerCase().includes(search.toLowerCase()));
  } else if (activeCategory) {
    exercises = CATEGORIES.find(c => c.label === activeCategory)?.exercises ?? [];
  } else {
    exercises = ALL_EXERCISES;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Add Exercise',
          headerStyle: { backgroundColor: c.surface },
          headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '700' },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
        {/* Search */}
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: c.surface, borderColor: c.border }]}>
            <FontAwesome name="search" size={15} color={c.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder="Search exercises…"
              placeholderTextColor={c.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <FontAwesome name="times-circle" size={16} color={c.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Category chips */}
        {search.length === 0 && (
          <FlatList
            data={[{ label: 'All', icon: '⚡' }, ...CATEGORIES]}
            keyExtractor={i => i.label}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipList}
            renderItem={({ item }) => {
              const isActive = item.label === 'All' ? activeCategory === null : activeCategory === item.label;
              return (
                <TouchableOpacity
                  style={[styles.chip, { backgroundColor: isActive ? c.accent : c.surface, borderColor: isActive ? c.accent : c.border }]}
                  onPress={() => setActiveCategory(item.label === 'All' ? null : item.label)}
                >
                  <Text style={styles.chipEmoji}>{item.icon}</Text>
                  <Text style={[styles.chipText, { color: isActive ? '#fff' : c.textSecondary }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Custom exercise */}
        <View style={[styles.customRow, { backgroundColor: c.surface, borderColor: c.border }]}>
          <TextInput
            style={[styles.customInput, { color: c.text }]}
            placeholder="Create custom exercise…"
            placeholderTextColor={c.textTertiary}
            value={custom}
            onChangeText={setCustom}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleCustomAdd}
          />
          <TouchableOpacity style={[styles.customAddBtn, { backgroundColor: c.accent }]} onPress={handleCustomAdd}>
            <FontAwesome name="plus" size={15} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Exercise list */}
        <FlatList
          data={exercises}
          keyExtractor={(i) => i}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.exItem, { backgroundColor: c.surface }]}
              onPress={() => handleSelect(item)}
              activeOpacity={0.75}
            >
              <Text style={[styles.exName, { color: c.text }]}>{item}</Text>
              <View style={[styles.addPill, { backgroundColor: c.accentSoft }]}>
                <FontAwesome name="plus" size={11} color={c.accent} />
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>No exercises found</Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: { padding: 14, paddingBottom: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 46, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '400' },
  chipList: { paddingHorizontal: 14, paddingVertical: 8, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1,
  },
  chipEmoji: { fontSize: 14 },
  chipText: { fontSize: 13, fontWeight: '600' },
  customRow: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    marginHorizontal: 14, marginBottom: 10, padding: 10,
    borderRadius: 14, borderWidth: 1,
  },
  customInput: { flex: 1, fontSize: 15, fontWeight: '400' },
  customAddBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  list: { paddingHorizontal: 14, borderRadius: 14, overflow: 'hidden' },
  exItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 15,
  },
  exName: { fontSize: 15, fontWeight: '500', flex: 1 },
  addPill: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  sep: { height: 1, marginLeft: 16 },
  empty: { padding: 28, alignItems: 'center' },
  emptyText: { fontSize: 15, fontWeight: '500' },
});
