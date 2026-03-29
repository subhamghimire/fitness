import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useTimerStore } from '@/store/timer.store';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');

export function FloatingRestTimer() {
  const { isActive, timeLeft, stopTimer, adjustTimer } = useTimerStore();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  // Slide-in animation
  const [translateY] = useState(new Animated.Value(100));

  useEffect(() => {
    if (isActive) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 12,
        speed: 14,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: 100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [isActive]);

  if (!isActive && translateY === new Animated.Value(100)) return null;

  const min = Math.floor(timeLeft / 60);
  const sec = timeLeft % 60;
  const timeString = `${min}:${sec < 10 ? '0' : ''}${sec}`;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
      <View style={[styles.pill, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
        
        <TouchableOpacity style={styles.actionBtn} onPress={() => adjustTimer(-15)}>
          <Text style={[styles.actionText, { color: c.textSecondary }]}>-15</Text>
        </TouchableOpacity>

        <View style={styles.centerBlock}>
          <FontAwesome name="hourglass-half" size={14} color={c.accent} style={{ marginBottom: 4 }} />
          <Text style={[styles.timerText, { color: c.text }]}>{timeString}</Text>
        </View>

        <TouchableOpacity style={styles.actionBtn} onPress={() => adjustTimer(15)}>
          <Text style={[styles.actionText, { color: c.textSecondary }]}>+15</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.closeBtn} onPress={stopTimer}>
          <FontAwesome name="times" size={16} color={c.textTertiary} />
        </TouchableOpacity>

      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100, // Above the bottom bar
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  centerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  timerText: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
