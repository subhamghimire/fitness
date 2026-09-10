import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSyncStore } from '@/store/sync.store';
import { syncService } from '@/sync/sync.service';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

const LABELS: Record<string, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  pending: 'Pending',
  offline: 'Offline',
  failed: 'Sync failed',
  conflict: 'Conflict resolved',
};

export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  if (status === 'idle' && pendingCount === 0) return null;

  const color =
    status === 'failed'
      ? c.danger
      : status === 'offline' || status === 'pending'
        ? c.textSecondary
        : status === 'syncing'
          ? c.accent
          : c.success;

  const label =
    status === 'pending' && pendingCount > 0
      ? `${pendingCount} pending`
      : LABELS[status] || status;

  return (
    <TouchableOpacity
      style={[styles.wrap, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
      onPress={() => syncService.triggerSync()}
      activeOpacity={0.75}
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
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: '600' },
});
