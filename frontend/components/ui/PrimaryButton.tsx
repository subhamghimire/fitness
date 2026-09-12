import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
}: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const bg =
    variant === 'danger' ? c.danger : variant === 'secondary' ? c.surfaceElevated : c.accent;
  const color = variant === 'secondary' ? c.text : '#FFFFFF';

  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: bg, opacity: disabled || loading ? 0.55 : 1 }, style]}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      disabled={disabled || loading}
      activeOpacity={0.82}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.label, { color }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
});
