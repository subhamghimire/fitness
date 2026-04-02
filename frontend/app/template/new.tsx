import React, { useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, TextInput,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useTemplateStore } from '@/store/template.store';
import { useColorScheme } from '@/components/useColorScheme';
import { TemplateExerciseCard } from '@/components/TemplateExerciseCard';
import { C } from '@/constants/Colors';

export default function NewTemplateScreen() {
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const {
    draftTemplate, initDraft, setDraftName, addSet, updateSet,
    removeSet, cycleSetType, removeExercise, saveDraft
  } = useTemplateStore();

  useEffect(() => { initDraft(); }, []);

  const handleSave = async () => {
    if (!draftTemplate?.name.trim()) {
      Alert.alert('Missing Name', 'Please give this template a name.', [{ text: 'OK' }]);
      return;
    }
    if (draftTemplate.exercises.length === 0) {
      Alert.alert('Empty Template', 'Add at least one exercise.', [{ text: 'OK' }]);
      return;
    }
    await saveDraft();
    router.replace('/(tabs)/templates');
  };

  const handleCancel = () => {
    Alert.alert('Discard Template', 'Are you sure you want to discard this template?', [
      { text: 'Keep Editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.replace('/(tabs)/templates') },
    ]);
  };

  const handleDelete = (exerciseId: string, name: string) => {
    Alert.alert('Remove Exercise', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeExercise(exerciseId) },
    ]);
  };

  if (!draftTemplate) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Template',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerShadowVisible: false,
          headerLeft: () => (
            <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.dangerSoft }]} onPress={handleCancel}>
              <Text style={[styles.headerBtnText, { color: c.danger }]}>Cancel</Text>
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity style={[styles.headerBtn, { backgroundColor: c.accentSoft }]} onPress={handleSave}>
              <Text style={[styles.headerBtnText, { color: c.accent }]}>Save</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          
          <View style={[styles.nameInputWrap, { backgroundColor: c.surfaceElevated }]}>
            <TextInput
              style={[styles.nameInput, { color: c.text }]}
              placeholder="Template Name e.g. Leg Day"
              placeholderTextColor={c.textTertiary}
              value={draftTemplate.name}
              onChangeText={setDraftName}
            />
          </View>

          {draftTemplate.exercises.map((exercise) => (
            <TemplateExerciseCard
              key={exercise.id}
              exercise={exercise}
              onAddSet={() => addSet(exercise.id)}
              onUpdateSet={updateSet}
              onDeleteSet={removeSet}
              onCycleSetType={cycleSetType}
              onDeleteExercise={() => handleDelete(exercise.id, exercise.name)}
              isDark={isDark}
            />
          ))}

          {draftTemplate.exercises.length === 0 && (
            <View style={[styles.emptyExercise, { borderColor: c.border }]}>
              <FontAwesome name="list" size={36} color={c.textTertiary} />
              <Text style={[styles.emptyExerciseTitle, { color: c.text }]}>Start building</Text>
              <Text style={[styles.emptyExerciseBody, { color: c.textSecondary }]}>
                Add exercises to template your routine
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottomBar, { backgroundColor: c.surface, borderTopColor: c.border }]}>
          <TouchableOpacity
            style={[styles.addExBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push('/template/exercise-picker')}
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
  container: { flex: 1 },
  headerBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  headerBtnText: { fontSize: 15, fontWeight: '800' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 110 },
  nameInputWrap: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    marginBottom: 20,
  },
  nameInput: {
    fontSize: 20,
    fontWeight: '800',
  },
  emptyExercise: {
    alignItems: 'center', paddingVertical: 40, borderRadius: 20, borderWidth: 1,
    borderStyle: 'dashed', gap: 12, marginTop: 8,
  },
  emptyExerciseTitle: { fontSize: 17, fontWeight: '700' },
  emptyExerciseBody: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingBottom: 34, paddingTop: 16, borderTopWidth: 1,
  },
  addExBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, borderRadius: 16, gap: 12,
    shadowColor: '#5E5CE6', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  addExText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
});
