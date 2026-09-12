import React, { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GroupedRow } from '@/components/ui/GroupedRow';
import { GroupedSection } from '@/components/ui/GroupedSection';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { TemplateRepository } from '@/repositories/template.repository';
import { useWorkoutStore } from '@/store/workout.store';
import type { Template } from '@/types';

export default function TemplatesScreen() {
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      setTemplates(await TemplateRepository.getAll());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void loadTemplates();
    }, [])
  );

  const startFromTemplateStore = useWorkoutStore((s) => s.startFromTemplate);
  const activeWorkout = useWorkoutStore((s) => s.activeWorkout);

  const startFromTemplate = async (t: Template) => {
    if (activeWorkout) {
      Alert.alert('Workout in progress', 'Finish or discard your current workout first.');
      return;
    }
    const id = await startFromTemplateStore(t);
    router.push(`/workout/${id}`);
  };

  const handleDeleteTemplate = (template: Template) => {
    Alert.alert('Delete Template', `Delete “${template.name}”?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await TemplateRepository.softDelete(template.id);
            setTemplates((prev) => prev.filter((item) => item.id !== template.id));
          } catch {
            Alert.alert('Delete Failed', 'Unable to delete this template.');
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={() => void loadTemplates()}
        ListHeaderComponent={
          <View style={styles.header}>
            <PrimaryButton label="New Template" onPress={() => router.push('/template/new')} variant="secondary" />
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              No templates yet. Save a routine so the next session starts in one tap.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const names = item.exercises.map((e) => e.name).join(', ');
          return (
            <GroupedSection style={styles.section}>
              <View style={styles.cardHead}>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
                  <Text style={[styles.cardDesc, { color: c.textSecondary }]} numberOfLines={2}>
                    {names || 'No exercises'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteTemplate(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={c.textTertiary} />
                </TouchableOpacity>
              </View>
              <GroupedRow
                label="Start Workout"
                last
                onPress={() => startFromTemplate(item)}
              />
            </GroupedSection>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingTop: 12, paddingBottom: 40 },
  header: { paddingHorizontal: 16, marginBottom: 16 },
  section: { marginBottom: 12 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 12,
  },
  cardCopy: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  cardDesc: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  empty: { paddingHorizontal: 32, paddingTop: 28, textAlign: 'center', fontSize: 15, lineHeight: 22 },
});
