import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { syncService } from '@/sync/sync.service';
import { getCompletedUnsyncedWorkouts } from '@/db/queries';
import { resetDatabase } from '@/db/database';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function SettingsScreen() {
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = Colors[colorScheme ?? 'light'];

  const { user, logout } = useAuthStore();

  useEffect(() => {
    loadUnsyncedCount();
  }, []);

  const loadUnsyncedCount = async () => {
    try {
      const workouts = await getCompletedUnsyncedWorkouts();
      setUnsyncedCount(workouts.length);
    } catch (error) {
      console.error('Failed to load unsynced count:', error);
    }
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncService.syncCompletedWorkouts();
      if (result.success) {
        Alert.alert(
          'Sync Complete',
          `Synced ${result.syncedWorkoutIds.length} workout(s)`
        );
      } else {
        Alert.alert('Sync Failed', result.errors.join('\n'));
      }
      await loadUnsyncedCount();
    } catch (error) {
      Alert.alert('Error', 'Failed to sync workouts');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleResetData = () => {
    Alert.alert(
      'Reset All Data',
      'This will delete all your local workout data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetDatabase();
              Alert.alert('Success', 'All local data has been reset');
              await loadUnsyncedCount();
            } catch (error) {
              Alert.alert('Error', 'Failed to reset data');
            }
          },
        },
      ]
    );
  };

  const SettingsSection = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text, opacity: 0.6 }]}>
        {title}
      </Text>
      <View
        style={[styles.sectionContent, { backgroundColor: isDark ? '#1c1c1e' : '#fff' }]}
      >
        {children}
      </View>
    </View>
  );

  const SettingsRow = ({
    icon,
    iconColor,
    label,
    value,
    onPress,
    showArrow = true,
    destructive = false,
  }: {
    icon: string;
    iconColor?: string;
    label: string;
    value?: string;
    onPress?: () => void;
    showArrow?: boolean;
    destructive?: boolean;
  }) => (
    <TouchableOpacity
      style={styles.settingsRow}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={styles.rowLeft}>
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: iconColor || colors.tint },
          ]}
        >
          <FontAwesome name={icon as any} size={16} color="#fff" />
        </View>
        <Text
          style={[
            styles.rowLabel,
            { color: destructive ? '#ff3b30' : colors.text },
          ]}
        >
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value && (
          <Text style={[styles.rowValue, { color: colors.text, opacity: 0.6 }]}>
            {value}
          </Text>
        )}
        {showArrow && onPress && (
          <FontAwesome
            name="chevron-right"
            size={14}
            color={isDark ? '#3a3a3c' : '#c7c7cc'}
          />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#000' : '#f2f2f7' }]}
      contentContainerStyle={styles.content}
    >
      {/* Account Section */}
      <SettingsSection title="Account">
        <SettingsRow
          icon="user"
          label="Email"
          value={user?.email || 'Not signed in'}
          showArrow={false}
        />
        <View style={[styles.separator, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} />
        <SettingsRow
          icon="sign-out"
          iconColor="#ff3b30"
          label="Sign Out"
          onPress={handleLogout}
          destructive
        />
      </SettingsSection>

      {/* Sync Section */}
      <SettingsSection title="Sync">
        <SettingsRow
          icon="cloud"
          iconColor="#34c759"
          label="Pending Syncs"
          value={`${unsyncedCount} workout(s)`}
          showArrow={false}
        />
        <View style={[styles.separator, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} />
        <SettingsRow
          icon="refresh"
          label={isSyncing ? 'Syncing...' : 'Sync Now'}
          onPress={isSyncing ? undefined : handleManualSync}
        />
      </SettingsSection>

      {/* Data Section */}
      <SettingsSection title="Data">
        <SettingsRow
          icon="database"
          iconColor="#ff9500"
          label="Storage"
          value="Local SQLite"
          showArrow={false}
        />
        <View style={[styles.separator, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} />
        <SettingsRow
          icon="trash"
          iconColor="#ff3b30"
          label="Reset All Data"
          onPress={handleResetData}
          destructive
        />
      </SettingsSection>

      {/* About Section */}
      <SettingsSection title="About">
        <SettingsRow
          icon="info"
          iconColor="#5856d6"
          label="Version"
          value="1.0.0"
          showArrow={false}
        />
        <View style={[styles.separator, { backgroundColor: isDark ? '#3a3a3c' : '#e5e5ea' }]} />
        <SettingsRow
          icon="code"
          iconColor="#007aff"
          label="Architecture"
          value="Local-First"
          showArrow={false}
        />
      </SettingsSection>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.text, opacity: 0.4 }]}>
          UdyamCoach
        </Text>
        <Text style={[styles.footerText, { color: colors.text, opacity: 0.3 }]}>
          Built with Expo + Zustand + SQLite
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingVertical: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginLeft: 16,
    marginBottom: 8,
  },
  sectionContent: {
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 16,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValue: {
    fontSize: 15,
  },
  separator: {
    height: 1,
    marginLeft: 56,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 13,
  },
});
