import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { GroupedRow } from '@/components/ui/GroupedRow';
import { GroupedSection } from '@/components/ui/GroupedSection';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { resetDatabase } from '@/db/database';
import { SyncRepository } from '@/repositories/sync.repository';
import { WorkoutRepository } from '@/repositories/workout.repository';
import { useAuthStore } from '@/store/auth.store';
import { usePreferencesStore } from '@/store/preferences.store';
import { useThemeStore, type ThemePreference } from '@/store/theme.store';
import { useTimerStore } from '@/store/timer.store';
import { useUnitStore, type WeightUnit } from '@/store/unit.store';
import { useWorkoutStore } from '@/store/workout.store';
import { syncService } from '@/sync/sync.service';
import { getSummaryMetrics } from '@/utils/analytics';
import type { ProgressionStyle } from '@/utils/progression';

const THEMES: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const UNITS: { key: WeightUnit; label: string }[] = [
  { key: 'kg', label: 'Kilograms' },
  { key: 'lb', label: 'Pounds' },
];

const PROGRESSION: { key: ProgressionStyle; label: string; detail: string }[] = [
  { key: 'double', label: 'Double progression', detail: 'Add reps, then weight' },
  { key: 'weight', label: 'Weight progression', detail: 'Raise load at the top of the range' },
  { key: 'reps', label: 'Rep progression', detail: 'Hold weight, push reps' },
  { key: 'manual', label: 'Manual', detail: 'No suggestions' },
];

export default function SettingsScreen() {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [totalWorkouts, setTotalWorkouts] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const { user, logout, refreshProfile } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const { unit, setUnit } = useUnitStore();
  const { progressionStyle, setProgressionStyle } = usePreferencesStore();

  const loadMeta = async () => {
    try {
      setUnsyncedCount(await SyncRepository.countPending());
    } catch {
      setUnsyncedCount(0);
    }
    try {
      const workouts = await WorkoutRepository.getHistory(500, 0);
      setTotalWorkouts(getSummaryMetrics(workouts).totalWorkouts);
    } catch {
      setTotalWorkouts(0);
    }
  };

  useEffect(() => {
    void loadMeta();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadMeta();
      void refreshProfile();
    }, [refreshProfile])
  );

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const r = await syncService.syncNow('manual');
      Alert.alert(
        r.success ? 'Synced' : 'Couldn’t sync',
        r.success
          ? r.syncedWorkoutIds.length
            ? `Uploaded ${r.syncedWorkoutIds.length} workout(s).`
            : 'Everything is up to date.'
          : 'Workouts stay on this device. We’ll retry later.'
      );
      await loadMeta();
    } catch {
      Alert.alert('Error', 'Failed to sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () =>
    Alert.alert('Sign Out', 'You can sign back in anytime. Local workouts stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);

  const handleReset = () =>
    Alert.alert('Reset All Data', 'This deletes local workouts on this phone. Cloud data is not wiped.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            await resetDatabase();
            useWorkoutStore.getState().clearSession();
            useTimerStore.getState().stopTimer();
            Alert.alert('Done', 'Local data cleared');
            await loadMeta();
          } catch {
            Alert.alert('Error', 'Failed to reset');
          }
        },
      },
    ]);

  const displayName = user?.name?.trim() || user?.email?.split('@')[0] || 'Athlete';
  const genderLabel = user?.gender
    ? user.gender.charAt(0).toUpperCase() + user.gender.slice(1)
    : undefined;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity
        style={[styles.profile, { backgroundColor: c.surface }]}
        onPress={() => router.push('/profile/edit')}
        activeOpacity={0.7}
      >
        <Avatar name={user?.name} email={user?.email} photoUrl={user?.photoUrl} size={64} />
        <View style={styles.profileText}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.email, { color: c.textSecondary }]} numberOfLines={1}>
            {user?.email}
          </Text>
          <Text style={[styles.edit, { color: c.accent }]}>Edit Profile</Text>
        </View>
      </TouchableOpacity>

      <Text style={[styles.statLine, { color: c.textSecondary }]}>
        {totalWorkouts} workout{totalWorkouts === 1 ? '' : 's'} logged
        {user?.age ? `  ·  ${user.age}` : ''}
        {genderLabel ? `  ·  ${genderLabel}` : ''}
      </Text>

      <GroupedSection title="Appearance">
        {THEMES.map((opt, i) => (
          <GroupedRow
            key={opt.key}
            label={opt.label}
            selected={mode === opt.key}
            last={i === THEMES.length - 1}
            onPress={() => setMode(opt.key)}
          />
        ))}
      </GroupedSection>

      <GroupedSection title="Weight unit">
        {UNITS.map((opt, i) => (
          <GroupedRow
            key={opt.key}
            label={opt.label}
            selected={unit === opt.key}
            last={i === UNITS.length - 1}
            onPress={() => setUnit(opt.key)}
          />
        ))}
      </GroupedSection>

      <GroupedSection title="Progression" footer="Suggestions appear on the next set after you complete work.">
        {PROGRESSION.map((opt, i) => (
          <GroupedRow
            key={opt.key}
            label={opt.label}
            detail={opt.detail}
            selected={progressionStyle === opt.key}
            last={i === PROGRESSION.length - 1}
            onPress={() => setProgressionStyle(opt.key)}
          />
        ))}
      </GroupedSection>

      <GroupedSection title="Data">
        <GroupedRow
          label={isSyncing ? 'Syncing…' : 'Sync Now'}
          value={`${unsyncedCount}`}
          onPress={isSyncing ? undefined : handleSync}
        />
        <GroupedRow label="Reset Local Data" onPress={handleReset} danger />
        <GroupedRow label="Sign Out" onPress={handleLogout} danger last />
      </GroupedSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 8, paddingBottom: 40, gap: 20 },
  profile: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileText: { flex: 1, gap: 2 },
  name: { fontSize: 22, fontWeight: '700', letterSpacing: 0.3 },
  email: { fontSize: 15 },
  edit: { fontSize: 15, fontWeight: '500', marginTop: 4 },
  statLine: { marginHorizontal: 32, fontSize: 13 },
});
