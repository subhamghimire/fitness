import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '@/store/auth.store';
import { useThemeStore, type ThemePreference } from '@/store/theme.store';
import { useUnitStore, type WeightUnit } from '@/store/unit.store';
import { syncService } from '@/sync/sync.service';
import { getAllWorkouts, getCompletedUnsyncedWorkouts } from '@/db/queries';
import { resetDatabase } from '@/db/database';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { getSummaryMetrics } from '@/utils/analytics';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

const UNIT_OPTIONS: { key: WeightUnit; label: string }[] = [
  { key: 'kg', label: 'Kilograms (kg)' },
  { key: 'lb', label: 'Pounds (lb)' },
];

export default function SettingsScreen() {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [totalWorkouts, setTotalWorkouts] = useState(0);
  const [totalVolume, setTotalVolume] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const { user, logout } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const { unit, setUnit } = useUnitStore();

  const loadProfileStats = async () => {
    try {
      const workouts = await getAllWorkouts();
      const metrics = getSummaryMetrics(workouts);
      setTotalWorkouts(metrics.totalWorkouts);
      setTotalVolume(metrics.totalVolume);
      setCurrentStreak(metrics.currentStreak);
    } catch {
      setTotalWorkouts(0);
      setTotalVolume(0);
      setCurrentStreak(0);
    }
  };

  useEffect(() => {
    loadCount();
    loadProfileStats();
  }, []);
  useFocusEffect(useCallback(() => {
    loadCount();
    loadProfileStats();
  }, []));

  const loadCount = async () => {
    try {
      setUnsyncedCount((await getCompletedUnsyncedWorkouts()).length);
    } catch {
      // noop
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const r = await syncService.syncCompletedWorkouts();
      Alert.alert(
        r.success ? 'Sync Complete' : 'Sync Failed',
        r.success ? `Synced ${r.syncedWorkoutIds.length} workout(s)` : r.errors.join('\n')
      );
      await loadCount();
    } catch {
      Alert.alert('Error', 'Failed to sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => Alert.alert('Sign Out', 'Are you sure?', [
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

  const handleReset = () => Alert.alert('Reset All Data', 'This will delete all local workout data.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Reset',
      style: 'destructive',
      onPress: async () => {
        try {
          await resetDatabase();
          Alert.alert('Done', 'All data cleared');
          await loadCount();
        } catch {
          Alert.alert('Error', 'Failed to reset');
        }
      },
    },
  ]);

  const username = useMemo(() => user?.email?.split('@')[0] ?? 'User', [user?.email]);
  const initials = (user?.email ?? 'U').slice(0, 1).toUpperCase();
  const volumeLabel = totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}K` : `${Math.round(totalVolume)}`;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.textSecondary }]}>{label}</Text>
    </View>
  );

  const ActionRow = ({ icon, iconBg, label, value, onPress, danger = false }: {
    icon: string;
    iconBg: string;
    label: string;
    value?: string;
    onPress?: () => void;
    danger?: boolean;
  }) => (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} disabled={!onPress} activeOpacity={0.75}>
      <View style={[styles.actionIcon, { backgroundColor: iconBg }]}> 
        <FontAwesome name={icon as any} size={15} color="#fff" />
      </View>
      <Text style={[styles.actionLabel, { color: danger ? c.danger : c.text }]}>{label}</Text>
      <View style={styles.actionRight}>
        {value ? <Text style={[styles.actionValue, { color: c.textSecondary }]}>{value}</Text> : null}
        {onPress ? <FontAwesome name="chevron-right" size={12} color={c.textTertiary} /> : null}
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: c.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.profileCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
        <View style={[styles.avatar, { backgroundColor: c.surfaceElevated }]}> 
          <Text style={[styles.avatarText, { color: c.text }]}>{initials}</Text>
        </View>
        <Text style={[styles.profileName, { color: c.text }]}>{username}</Text>
        <Text style={[styles.profileEmail, { color: c.textSecondary }]}>{user?.email ?? ''}</Text>

        <View style={[styles.statsRow, { borderTopColor: c.border }]}> 
          <Stat label="Workouts" value={String(totalWorkouts)} />
          <Stat label="Volume" value={volumeLabel} />
          <Stat label="Streak" value={String(currentStreak)} />
        </View>
      </View>

      <View style={[styles.themeCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Appearance</Text>
        <View style={[styles.themeSegment, { backgroundColor: c.surfaceElevated }]}> 
          {THEME_OPTIONS.map((opt) => {
            const selected = mode === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setMode(opt.key)}
                style={[
                  styles.themeOption,
                  selected && { backgroundColor: c.background, borderColor: c.border, borderWidth: 1 },
                ]}
                activeOpacity={0.8}
              >
                <Ionicons name={opt.icon} size={15} color={selected ? c.accent : c.textSecondary} />
                <Text style={[styles.themeOptionText, { color: selected ? c.text : c.textSecondary }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[styles.themeCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
        <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Weight Unit</Text>
        <View style={[styles.unitList, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
          {UNIT_OPTIONS.map((opt) => {
            const selected = unit === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.unitRow, selected && { backgroundColor: c.accentSoft }]}
                onPress={() => setUnit(opt.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.unitRowText, { color: selected ? c.accent : c.text }]}>{opt.label}</Text>
                {selected ? <Ionicons name="checkmark-circle" size={18} color={c.accent} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={[styles.actionsCard, { backgroundColor: c.surface, borderColor: c.border }]}> 
        <ActionRow
          icon="refresh"
          iconBg={c.accent}
          label={isSyncing ? 'Syncing...' : 'Sync Now'}
          value={`${unsyncedCount}`}
          onPress={isSyncing ? undefined : handleSync}
        />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <ActionRow icon="trash" iconBg={c.danger} label="Reset All Data" onPress={handleReset} danger />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <ActionRow icon="sign-out" iconBg={c.danger} label="Sign Out" onPress={handleLogout} danger />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 42, gap: 16 },
  profileCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 30, fontWeight: '800' },
  profileName: { fontSize: 22, fontWeight: '800', marginTop: 12, letterSpacing: -0.3 },
  profileEmail: { fontSize: 14, marginTop: 4 },
  statsRow: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '500', marginTop: 2 },
  themeCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  themeSegment: {
    borderRadius: 14,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  themeOption: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  themeOptionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  unitList: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  unitRow: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitRowText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionsCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  actionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: { height: 1, marginLeft: 58 },
});
