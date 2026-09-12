import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  selected?: boolean;
  last?: boolean;
  detail?: string;
};

export function GroupedRow({ label, value, onPress, danger, selected, last, detail }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const labelColor = danger ? c.danger : c.text;

  const body = (
    <View style={[styles.row, !last && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.left}>
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        {detail ? <Text style={[styles.detail, { color: c.textTertiary }]}>{detail}</Text> : null}
      </View>
      <View style={styles.right}>
        {value ? <Text style={[styles.value, { color: c.textSecondary }]}>{value}</Text> : null}
        {selected ? <Ionicons name="checkmark" size={20} color={c.accent} /> : null}
        {onPress && !selected && !danger ? (
          <Ionicons name="chevron-forward" size={16} color={c.textTertiary} />
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.65} disabled={!onPress}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  left: { flex: 1 },
  label: { fontSize: 17, fontWeight: '400' },
  detail: { fontSize: 13, marginTop: 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 17, fontWeight: '400' },
});
