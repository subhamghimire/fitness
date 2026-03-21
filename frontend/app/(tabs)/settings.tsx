import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { syncService } from '@/sync/sync.service';
import { getCompletedUnsyncedWorkouts } from '@/db/queries';
import { resetDatabase } from '@/db/database';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

export default function SettingsScreen() {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const { user, logout } = useAuthStore();

  useEffect(() => { loadCount(); }, []);

  const loadCount = async () => {
    try { setUnsyncedCount((await getCompletedUnsyncedWorkouts()).length); } catch (e) { /* noop */ }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const r = await syncService.syncCompletedWorkouts();
      Alert.alert(r.success ? 'Sync Complete' : 'Sync Failed',
        r.success ? `Synced ${r.syncedWorkoutIds.length} workout(s)` : r.errors.join('\n'));
      await loadCount();
    } catch { Alert.alert('Error', 'Failed to sync'); }
    finally { setIsSyncing(false); }
  };

  const handleLogout = () => Alert.alert('Sign Out', 'Are you sure?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign Out', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
  ]);

  const handleReset = () => Alert.alert('Reset All Data', 'This will delete all local workout data.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Reset', style: 'destructive', onPress: async () => {
      try { await resetDatabase(); Alert.alert('Done', 'All data cleared'); await loadCount(); }
      catch { Alert.alert('Error', 'Failed to reset'); }
    }},
  ]);

  const initials = (user?.email ?? 'U').slice(0, 1).toUpperCase();

  const Row = ({ icon, iconBg, label, value, onPress, danger = false }: {
    icon: string; iconBg: string; label: string; value?: string; onPress?: () => void; danger?: boolean;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
        <FontAwesome name={icon as any} size={15} color="#fff" />
      </View>
      <Text style={[styles.rowLabel, { color: danger ? c.danger : c.text }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value && <Text style={[styles.rowValue, { color: c.textSecondary }]}>{value}</Text>}
        {onPress && <FontAwesome name="chevron-right" size={12} color={c.textTertiary} />}
      </View>
    </TouchableOpacity>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{title}</Text>
      <View style={[styles.sectionBox, { backgroundColor: c.surface, borderColor: c.border }]}>
        {children}
      </View>
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.background }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {/* Avatar card */}
      <View style={[styles.profileCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={[styles.avatar, { backgroundColor: c.accentMid }]}>
          <Text style={[styles.avatarText, { color: c.accent }]}>{initials}</Text>
        </View>
        <View>
          <Text style={[styles.profileName, { color: c.text }]}>{user?.email?.split('@')[0] ?? 'User'}</Text>
          <Text style={[styles.profileEmail, { color: c.textSecondary }]}>{user?.email ?? ''}</Text>
        </View>
      </View>

      <Section title="SYNC">
        <Row icon="cloud" iconBg={c.success} label="Pending Syncs" value={`${unsyncedCount}`} />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <Row icon="refresh" iconBg={c.accent} label={isSyncing ? 'Syncing…' : 'Sync Now'} onPress={isSyncing ? undefined : handleSync} />
      </Section>

      <Section title="DATA">
        <Row icon="database" iconBg={c.warning} label="Storage" value="Local SQLite" />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <Row icon="trash" iconBg={c.danger} label="Reset All Data" onPress={handleReset} danger />
      </Section>

      <Section title="ABOUT">
        <Row icon="info" iconBg="#5856D6" label="Version" value="1.0.0" />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <Row icon="code" iconBg="#007AFF" label="Architecture" value="Local-First" />
      </Section>

      <Section title="ACCOUNT">
        <Row icon="sign-out" iconBg={c.danger} label="Sign Out" onPress={handleLogout} danger />
      </Section>

      <Text style={[styles.footer, { color: c.textTertiary }]}>FitTrack • Built with Expo + SQLite</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48, gap: 20 },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    padding: 20, borderRadius: 18, borderWidth: 1,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  avatar: { width: 56, height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 24, fontWeight: '800' },
  profileName: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  profileEmail: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  section: { gap: 6 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginLeft: 4 },
  sectionBox: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  iconBox: { width: 32, height: 32, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { fontSize: 14, fontWeight: '500' },
  divider: { height: 1, marginLeft: 62 },
  footer: { textAlign: 'center', fontSize: 12, fontWeight: '500', marginTop: 8 },
});
