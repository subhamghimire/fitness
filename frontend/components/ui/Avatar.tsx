import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

type Props = {
  name?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  size?: number;
};

function initialsFrom(name?: string | null, email?: string | null) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 1).toUpperCase();
}

export function Avatar({ name, email, photoUrl, size = 64 }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const initials = initialsFrom(name, email);

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.surfaceElevated,
        },
      ]}
    >
      <Text style={[styles.initials, { color: c.text, fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: '#3A3A3C' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '600' },
});
