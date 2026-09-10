import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import {
  calculatePlates,
  DEFAULT_PLATE_CONFIG_KG,
  DEFAULT_PLATE_CONFIG_LB,
  formatPlateStack,
} from '@/utils/plates';

export default function PlateCalculatorScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((s) => s.unit);
  const [target, setTarget] = useState(unit === 'lb' ? '135' : '100');

  const config = unit === 'lb' ? DEFAULT_PLATE_CONFIG_LB : DEFAULT_PLATE_CONFIG_KG;
  const result = useMemo(() => {
    const n = parseFloat(target);
    if (!target || Number.isNaN(n)) return null;
    return calculatePlates(n, config);
  }, [target, config]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Plate calculator',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.surface },
          headerTintColor: c.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: c.background }]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: c.textSecondary }]}>Target load ({unit})</Text>
        <TextInput
          style={[styles.input, { backgroundColor: c.surface, color: c.text }]}
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
          selectTextOnFocus
        />

        <Text style={[styles.meta, { color: c.textTertiary }]}>
          Bar {config.barWeight} {unit}
        </Text>

        {result && (
          <View style={[styles.card, { backgroundColor: c.surface }]}>
            <Text style={[styles.resultTitle, { color: c.text }]}>
              {result.achievable ? 'Per side' : 'Closest match'}
            </Text>
            <Text style={[styles.stack, { color: c.text }]}>
              {formatPlateStack(result, unit)}
            </Text>
            {result.perSide.map((p) => (
              <View key={p.weight} style={styles.row}>
                <Text style={[styles.plate, { color: c.text }]}>
                  {p.weight} {unit}
                </Text>
                <Text style={[styles.count, { color: c.textSecondary }]}>× {p.count}</Text>
              </View>
            ))}
            <Text style={[styles.total, { color: c.textSecondary }]}>
              Total {result.totalLoaded} {unit}
            </Text>
            {result.message ? (
              <Text style={[styles.warn, { color: c.warning }]}>{result.message}</Text>
            ) : null}
          </View>
        )}

        <View style={styles.quickRow}>
          {(unit === 'kg' ? [60, 80, 100, 120, 140] : [95, 135, 185, 225, 275]).map((w) => (
            <TouchableOpacity
              key={w}
              style={[styles.quick, { backgroundColor: c.surfaceElevated }]}
              onPress={() => setTarget(String(w))}
            >
              <Text style={[styles.quickText, { color: c.text }]}>{w}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  meta: { fontSize: 13, fontWeight: '500' },
  card: { borderRadius: 14, padding: 16, gap: 8, marginTop: 8 },
  resultTitle: { fontSize: 13, fontWeight: '600' },
  stack: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  plate: { fontSize: 16, fontWeight: '600' },
  count: { fontSize: 16, fontWeight: '500' },
  total: { fontSize: 13, fontWeight: '500', marginTop: 8 },
  warn: { fontSize: 13, fontWeight: '500' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  quick: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  quickText: { fontSize: 15, fontWeight: '700' },
});
