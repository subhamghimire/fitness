import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useWorkoutStore } from '@/store/workout.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { getAllTemplates } from '@/db/templateQueries';
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
      const data = await getAllTemplates();
      setTemplates(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadTemplates();
    }, [])
  );

  const { startFromTemplate: storeStartTemplate, activeWorkout } = useWorkoutStore();

  const startFromTemplate = async (t: Template) => {
    if (activeWorkout) {
      alert('You already have an active workout in progress!');
      return;
    }
    const id = await storeStartTemplate(t);
    router.push(`/workout/${id}`);
  };

  const renderTemplateCard = ({ item }: { item: Template }) => {
    const exCount = item.exercises.length;
    const exNames = item.exercises.slice(0, 3).map(e => e.name).join(', ') + (exCount > 3 ? '...' : '');

    return (
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: c.text }]}>{item.name}</Text>
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
        
        <Text style={[styles.cardDesc, { color: c.textSecondary }]} numberOfLines={2}>
          {exCount > 0 ? exNames : 'No exercises'}
        </Text>

        <TouchableOpacity 
          style={[styles.startBtn, { backgroundColor: c.accentSoft }]} 
          onPress={() => startFromTemplate(item)}
          activeOpacity={0.7}
        >
          <Text style={[styles.startBtnText, { color: c.accent }]}>Start Workout</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={templates}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadTemplates} tintColor={c.accent} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <FontAwesome name="clipboard" size={48} color={c.textTertiary} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>No Templates</Text>
              <Text style={[styles.emptyDesc, { color: c.textSecondary }]}>Create a template to quickly start your routine without adding exercises manually.</Text>
            </View>
          ) : null
        }
        renderItem={renderTemplateCard}
      />

      {/* Floating Action Button */}
      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: c.accent }]} 
        onPress={() => router.push('/template/new')}
        activeOpacity={0.8}
      >
        <FontAwesome name="plus" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    flex: 1,
  },
  cardDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  startBtn: {
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  emptyDesc: { fontSize: 15, textAlign: 'center', paddingHorizontal: 40, lineHeight: 22 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#5E5CE6',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
  },
});
