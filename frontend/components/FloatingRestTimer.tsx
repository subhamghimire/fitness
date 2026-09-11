import React, { useEffect, useRef, useState, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTimerStore } from '@/store/timer.store';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

function FloatingRestTimerComponent() {
  const isActive = useTimerStore((s) => s.isActive);
  const timeLeft = useTimerStore((s) => s.timeLeft);
  const stopTimer = useTimerStore((s) => s.stopTimer);
  const adjustTimer = useTimerStore((s) => s.adjustTimer);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const insets = useSafeAreaInsets();

  const translateY = useRef(new Animated.Value(120)).current;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (isActive) {
      setMounted(true);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(translateY, {
        toValue: 120,
        duration: 160,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [isActive, mounted, translateY]);

  if (!mounted && !isActive) return null;

  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  const timeString = `${min}:${sec < 10 ? '0' : ''}${sec}`;

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: 72 + Math.max(insets.bottom, 8), transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={[styles.pill, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => adjustTimer(-15)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.actionText, { color: c.textSecondary }]}>−15</Text>
        </TouchableOpacity>

        <Text style={[styles.timerText, { color: c.text }]}>{timeString}</Text>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => adjustTimer(15)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.actionText, { color: c.textSecondary }]}>+15</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeBtn}
          onPress={() => {
            void Haptics.selectionAsync();
            stopTimer();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <FontAwesome name="times" size={14} color={c.textTertiary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

export const FloatingRestTimer = memo(FloatingRestTimerComponent);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    gap: 2,
  },
  timerText: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 52,
    textAlign: 'center',
  },
  actionBtn: {
    minWidth: 44,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  closeBtn: {
    width: 36,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
