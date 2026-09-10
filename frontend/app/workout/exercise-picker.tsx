import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { WorkoutRepository } from '@/repositories/workout.repository';

const CATEGORIES: { label: string; icon: string; exercises: string[] }[] = [
  { label: 'Chest', icon: 'heart', exercises: ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Dumbbell Press', 'Dumbbell Fly', 'Cable Fly', 'Push Up', 'Chest Dip'] },
  { label: 'Back', icon: 'exchange', exercises: ['Deadlift', 'Barbell Row', 'Dumbbell Row', 'Pull Up', 'Chin Up', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row'] },
  { label: 'Shoulders', icon: 'dot-circle-o', exercises: ['Overhead Press', 'Military Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly', 'Face Pull', 'Shrug'] },
  { label: 'Arms', icon: 'flash', exercises: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Tricep Extension', 'Skull Crusher', 'Close Grip Bench Press'] },
  { label: 'Legs', icon: 'soccer-ball-o', exercises: ['Squat', 'Front Squat', 'Leg Press', 'Hack Squat', 'Lunge', 'Bulgarian Split Squat', 'Romanian Deadlift', 'Leg Curl', 'Leg Extension', 'Calf Raise'] },
  { label: 'Core', icon: 'bullseye', exercises: ['Plank', 'Crunch', 'Leg Raise', 'Ab Wheel Rollout', 'Cable Crunch', 'Russian Twist'] },
];

const ALL_EXERCISES = CATEGORIES.flatMap((c) => c.exercises);

export default function ExercisePickerScreen() {
  const { replaceExerciseId, currentName } = useLocalSearchParams<{
    replaceExerciseId?: string;
    currentName?: string;
  }>();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const addExercise = useWorkoutStore((s) => s.addExercise);
  const addSet = useWorkoutStore((s) => s.addSet);
  const updateExercise = useWorkoutStore((s) => s.updateExercise);
  const loadPreviousSets = useWorkoutStore((s) => s.loadPreviousSets);
  const isReplaceMode = !!replaceExerciseId;

  useEffect(() => {
    WorkoutRepository.recentExerciseNames(12)
      .then(setRecent)
      .catch(() => undefined);
  }, []);

  const handleSelect = useCallback(
    async (name: string) => {
      void Haptics.selectionAsync();
      router.back();
      try {
        if (replaceExerciseId) {
          await updateExercise(replaceExerciseId, { name });
          await loadPreviousSets(replaceExerciseId, name);
        } else {
          const id = await addExercise(name);
          await addSet(id);
        }
      } catch {
        Alert.alert('Could not add exercise', 'Please try again.');
      }
    },
    [addExercise, addSet, loadPreviousSets, replaceExerciseId, router, updateExercise]
  );

  const handleCustomAdd = async () => {
    const name = custom.trim();
    if (!name) return;
    await handleSelect(name);
  };

  const exercises = useMemo(() => {
    if (search.length > 0) {
      const q = search.toLowerCase();
      return ALL_EXERCISES.filter((e) => e.toLowerCase().includes(q));
    }
    if (activeCategory) {
      return CATEGORIES.find((cat) => cat.label === activeCategory)?.exercises ?? [];
    }
    return ALL_EXERCISES;
  }, [search, activeCategory]);

  return (
    <>
      <Stack.Screen
        options={{
          title: isReplaceMode ? 'Replace Exercise' : 'Add Exercise',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '700' },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: c.danger, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            isReplaceMode ? (
              <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '500' }} numberOfLines={1}>
                {currentName}
              </Text>
            ) : (
              <View style={{ width: 54 }} />
            ),
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
        <View style={styles.searchWrap}>
          <View style={[styles.searchBar, { backgroundColor: c.surfaceElevated }]}>
            <FontAwesome name="search" size={14} color={c.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder="Search…"
              placeholderTextColor={c.textTertiary}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
        </View>

        {search.length === 0 && recent.length > 0 && (
          <View style={styles.recentBlock}>
            <Text style={[styles.recentLabel, { color: c.textTertiary }]}>Recent</Text>
            {recent.slice(0, 6).map((name) => (
              <TouchableOpacity key={name} style={styles.exItem} onPress={() => handleSelect(name)} activeOpacity={0.55}>
                <Text style={[styles.exName, { color: c.text }]}>{name}</Text>
                <FontAwesome name="plus" size={12} color={c.accent} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {search.length === 0 && (
          <FlatList
            data={[{ label: 'All', icon: 'th-large' }, ...CATEGORIES]}
            keyExtractor={(i) => i.label}
            horizontal
            style={styles.chipScroller}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipList}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const isActive = item.label === 'All' ? activeCategory === null : activeCategory === item.label;
              return (
                <TouchableOpacity
                  style={[styles.chip, { backgroundColor: isActive ? c.accent : c.surface }]}
                  onPress={() => setActiveCategory(item.label === 'All' ? null : item.label)}
                >
                  <Text style={[styles.chipText, { color: isActive ? '#fff' : c.textSecondary }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        <View style={styles.customRow}>
          <TextInput
            style={[styles.customInput, { color: c.text, backgroundColor: c.surface }]}
            placeholder="Custom exercise name"
            placeholderTextColor={c.textTertiary}
            value={custom}
            onChangeText={setCustom}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handleCustomAdd}
          />
          <TouchableOpacity
            style={[styles.customAddBtn, { backgroundColor: custom.trim() ? c.accent : c.surfaceElevated }]}
            onPress={handleCustomAdd}
            activeOpacity={0.8}
          >
            <FontAwesome name="plus" size={14} color={custom.trim() ? '#fff' : c.textSecondary} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={exercises}
          keyExtractor={(i) => i}
          style={styles.listWrap}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.exItem} onPress={() => handleSelect(item)} activeOpacity={0.55}>
              <Text style={[styles.exName, { color: c.text }]}>{item}</Text>
              <FontAwesome name="plus" size={12} color={c.accent} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>No matches — add it as custom above</Text>
            </View>
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '400', paddingVertical: 0 },
  chipList: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  chipScroller: { flexGrow: 0, maxHeight: 44 },
  chip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  recentBlock: { paddingHorizontal: 8, marginBottom: 4 },
  recentLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  customRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 8,
  },
  customInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    fontSize: 15,
    borderRadius: 10,
  },
  customAddBtn: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  listWrap: { flex: 1 },
  list: { paddingHorizontal: 8, paddingBottom: 24 },
  exItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  exName: { fontSize: 16, fontWeight: '500', flex: 1 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 12 },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
});
