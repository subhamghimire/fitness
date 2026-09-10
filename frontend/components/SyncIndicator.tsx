import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSyncStore } from '@/store/sync.store';
import { syncService } from '@/sync/sync.service';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

const LABELS: Record<string, string> = {
  idle: '',
  syncing: 'Syncing',
  pending: 'Pending',
  offline: 'Offline',
  failed: 'Retry',
  conflict: 'Synced',
};

export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  if ((status === 'idle' || status === 'conflict') && pendingCount === 0) return null;

  const color =
    status === 'failed'
      ? c.danger
      : status === 'offline' || status === 'pending'
        ? c.textTertiary
        : status === 'syncing'
          ? c.accent
          : c.textSecondary;

  const label =
    status === 'pending' && pendingCount > 0
      ? `${pendingCount}`
      : LABELS[status] || '';

  if (!label) return null;

  return (
    <TouchableOpacity
      style={styles.wrap}
      onPress={() => syncService.triggerSync()}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={`Sync status: ${label}`}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color: c.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: '600' },
});
