import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = TextInputProps & {
  label: string;
  hint?: string;
};

export function NativeTextField({ label, hint, style, ...rest }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          { color: c.text, backgroundColor: c.surface, borderColor: c.border },
          style,
        ]}
        placeholderTextColor={c.textTertiary}
        {...rest}
      />
      {hint ? <Text style={[styles.hint, { color: c.textTertiary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '400' },
  input: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 17,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hint: { fontSize: 12 },
});
