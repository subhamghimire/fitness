import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Alert
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getAllWorkouts } from '@/db/queries';
import { useColorScheme } from '@/components/useColorScheme';
import { formatDate, formatDuration } from '@/utils/date';
import { C } from '@/constants/Colors';
import type { Workout } from '@/types';

export default function HistoryScreen() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const c = isDark ? C.dark : C.light;

  const loadWorkouts = async () => {
    try { 
      const raw = await getAllWorkouts();
      setWorkouts(raw); 
    } catch (e) { 
      Alert.alert('History Error', String(e));
      console.error(e); 
    }
  };

  useFocusEffect(useCallback(() => { loadWorkouts(); }, []));

  const onRefresh = async () => { setRefreshing(true); await loadWorkouts(); setRefreshing(false); };

  const getTotalSets = (w: Workout) => w.exercises.reduce((s, ex) => s + ex.sets.length, 0);
  const getTotalVolume = (w: Workout) =>
    w.exercises.reduce((s, ex) => s + ex.sets.reduce((ss, set) => ss + (set.weight ?? 0) * (set.reps ?? 0), 0), 0);

  const renderItem = ({ item: w }: { item: Workout }) => (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Header */}
      <View style={styles.cardHead}>
        <View>
          <Text style={[styles.cardDate, { color: c.text }]}>{formatDate(w.startedAt)}</Text>
          <Text style={[styles.cardDuration, { color: c.textSecondary }]}>
            {formatDuration(w.startedAt, w.endedAt)}
          </Text>
        </View>
        <View style={[styles.badge, {
          backgroundColor: w.status === 'synced' ? c.successSoft : c.surfaceElevated,
        }]}>
          <FontAwesome name={w.status === 'synced' ? 'cloud' : 'mobile'} size={10}
            color={w.status === 'synced' ? c.success : c.textSecondary} />
          <Text style={[styles.badgeText, { color: w.status === 'synced' ? c.success : c.textSecondary }]}>
            {w.status === 'synced' ? 'Synced' : 'Local'}
          </Text>
        </View>
      </View>

      {/* Stats pills */}
      <View style={styles.statsRow}>
        {[
          { label: 'Exercises', value: String(w.exercises.length) },
          { label: 'Sets', value: String(getTotalSets(w)) },
          { label: 'Volume', value: `${(getTotalVolume(w) / 1000).toFixed(1)}k kg` },
        ].map((s, i) => (
          <View key={i} style={[styles.statPill, { backgroundColor: c.surfaceElevated }]}>
            <Text style={[styles.statPillValue, { color: c.text }]}>{s.value}</Text>
            <Text style={[styles.statPillLabel, { color: c.textSecondary }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Exercise tags */}
      {w.exercises.length > 0 && (
        <View style={[styles.exTagsRow, { borderTopColor: c.border }]}>
          {w.exercises.slice(0, 4).map((ex) => (
            <View key={ex.id} style={[styles.exTag, { backgroundColor: c.accentSoft }]}>
              <Text style={[styles.exTagText, { color: c.accent }]} numberOfLines={1}>{ex.name}</Text>
            </View>
          ))}
          {w.exercises.length > 4 && (
            <Text style={[styles.exMore, { color: c.textSecondary }]}>+{w.exercises.length - 4} more</Text>
          )}
        </View>
      )}
    </View>
  );

  const Empty = () => (
    <View style={styles.empty}>
      <FontAwesome name="calendar-o" size={52} color={c.textTertiary} />
      <Text style={[styles.emptyTitle, { color: c.text }]}>No History Yet</Text>
      <Text style={[styles.emptySub, { color: c.textSecondary }]}>Complete a workout to see it here</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <FlatList
        data={workouts}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, workouts.length === 0 && styles.listEmpty]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={Empty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16, paddingBottom: 32 },
  listEmpty: { flex: 1, justifyContent: 'center' },
  card: {
    borderRadius: 16, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, paddingBottom: 12 },
  cardDate: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  cardDuration: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  statPill: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  statPillValue: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  statPillLabel: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  exTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, padding: 12 },
  exTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  exTagText: { fontSize: 12, fontWeight: '600' },
  exMore: { fontSize: 12, fontWeight: '500', alignSelf: 'center' },
  empty: { alignItems: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center' },
});
