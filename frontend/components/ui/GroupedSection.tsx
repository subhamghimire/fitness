import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  title?: string;
  footer?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function GroupedSection({ title, footer, children, style }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  return (
    <View style={[styles.wrap, style]}>
      {title ? <Text style={[styles.title, { color: c.textSecondary }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: c.surface }]}>{children}</View>
      {footer ? <Text style={[styles.footer, { color: c.textTertiary }]}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16 },
  title: {
    fontSize: 13,
    fontWeight: '400',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 16,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  footer: {
    fontSize: 13,
    marginTop: 8,
    marginHorizontal: 16,
    lineHeight: 18,
  },
});
