import React, { useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useTemplateStore } from '@/store/template.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

const CATEGORIES = [
  { label: 'Chest', icon: 'heart', exercises: ['Bench Press', 'Incline Bench Press', 'Decline Bench Press', 'Dumbbell Press', 'Dumbbell Fly', 'Cable Fly', 'Push Up', 'Chest Dip'] },
  { label: 'Back', icon: 'exchange', exercises: ['Deadlift', 'Barbell Row', 'Dumbbell Row', 'Pull Up', 'Chin Up', 'Lat Pulldown', 'Seated Cable Row', 'T-Bar Row'] },
  { label: 'Shoulders', icon: 'dot-circle-o', exercises: ['Overhead Press', 'Military Press', 'Dumbbell Shoulder Press', 'Lateral Raise', 'Front Raise', 'Rear Delt Fly', 'Face Pull', 'Shrug'] },
  { label: 'Arms', icon: 'flash', exercises: ['Barbell Curl', 'Dumbbell Curl', 'Hammer Curl', 'Preacher Curl', 'Tricep Pushdown', 'Tricep Extension', 'Skull Crusher', 'Close Grip Bench Press'] },
  { label: 'Legs', icon: 'soccer-ball-o', exercises: ['Squat', 'Front Squat', 'Leg Press', 'Hack Squat', 'Lunge', 'Bulgarian Split Squat', 'Romanian Deadlift', 'Leg Curl', 'Leg Extension', 'Calf Raise'] },
  { label: 'Core', icon: 'bullseye', exercises: ['Plank', 'Crunch', 'Leg Raise', 'Ab Wheel Rollout', 'Cable Crunch', 'Russian Twist'] },
];

const ALL_EXERCISES = CATEGORIES.flatMap(c => c.exercises);

export default function TemplateExercisePickerScreen() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  
  const { addExercise, addSet } = useTemplateStore();

  const handleSelect = (name: string) => {
    try {
      const id = addExercise(name);
      addSet(id);
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to add exercise');
    }
  };

  const handleCustomAdd = () => {
    const name = custom.trim();
    if (!name) { Alert.alert('Error', 'Enter an exercise name'); return; }
    handleSelect(name);
  };

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
          title: 'Add to Template',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '700' },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: c.danger, fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () => <View style={{ width: 54 }} />,
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
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
                <FontAwesome name="times-circle" size={16} color={c.danger} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {search.length === 0 && (
          <FlatList
            data={[{ label: 'All', icon: 'th-large' }, ...CATEGORIES]}
            keyExtractor={i => i.label}
            horizontal
            style={styles.chipScroller}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipList}
            renderItem={({ item }) => {
              const isActive = item.label === 'All' ? activeCategory === null : activeCategory === item.label;
              return (
                <TouchableOpacity
                  style={[styles.chip, { backgroundColor: isActive ? c.accent : c.surface, borderColor: isActive ? c.accent : c.border }]}
                  onPress={() => setActiveCategory(item.label === 'All' ? null : item.label)}
                >
                  {item.label === 'All' ? (
                    <FontAwesome name={item.icon as any} size={12} color={isActive ? '#fff' : c.textSecondary} />
                  ) : null}
                  <Text style={[styles.chipText, { color: isActive ? '#fff' : c.textSecondary }]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        <View style={[styles.customCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.customLabel, { color: c.textSecondary }]}>Custom Exercise</Text>
          <View style={styles.customRow}>
            <TextInput
              style={[styles.customInput, { color: c.text }]}
              placeholder="Type exercise name"
              placeholderTextColor={c.textTertiary}
              value={custom}
              onChangeText={setCustom}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleCustomAdd}
            />
            <TouchableOpacity
              style={[
                styles.customAddBtn,
                { backgroundColor: custom.trim() ? c.accent : c.surfaceElevated },
              ]}
              onPress={handleCustomAdd}
              activeOpacity={0.85}
            >
              <FontAwesome name="plus" size={14} color={custom.trim() ? '#fff' : c.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <FlatList
          data={exercises}
          keyExtractor={(i) => i}
          style={[styles.listWrap, { backgroundColor: c.surface, borderColor: c.border }]}
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
              <View style={[styles.addPill, { backgroundColor: c.surfaceElevated }]}>
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
  searchWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    height: 44, borderRadius: 12, paddingHorizontal: 14, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '400' },
  chipList: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chipScroller: { flexGrow: 0 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  customCard: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  customLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  customRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: 10,
    padding: 8,
  },
  customInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 8,
    fontSize: 15,
  },
  customAddBtn: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  listWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  list: { paddingVertical: 2 },
  exItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 56, paddingHorizontal: 16,
  },
  exName: { fontSize: 16, fontWeight: '500', flex: 1 },
  addPill: { width: 30, height: 30, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  sep: { height: 1, marginLeft: 16, marginRight: 16 },
  empty: { padding: 28, alignItems: 'center' },
  emptyText: { fontSize: 15, fontWeight: '500' },
});
