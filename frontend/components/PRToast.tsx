import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import type { PersonalRecord } from '@/utils/prs';

interface PRToastContextValue {
  showPRs: (prs: PersonalRecord[]) => void;
}

const PRToastContext = createContext<PRToastContextValue>({ showPRs: () => undefined });

export function usePRToast() {
  return useContext(PRToastContext);
}

export function PRToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const showPRs = useCallback(
    (prs: PersonalRecord[]) => {
      if (prs.length === 0) return;
      const text =
        prs.length === 1
          ? `${prs[0].label}: ${prs[0].valueLabel}`
          : `${prs.length} PRs — ${prs[0].label}`;
      setMessage(text);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
          setMessage(null)
        );
      }, 2200);
    },
    [opacity]
  );

  const value = useMemo(() => ({ showPRs }), [showPRs]);

  return (
    <PRToastContext.Provider value={value}>
      {children}
      {message ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, { backgroundColor: c.surface, borderColor: c.border, opacity }]}
        >
          <View style={[styles.dot, { backgroundColor: c.success }]} />
          <Text style={[styles.text, { color: c.text }]} numberOfLines={1}>
            {message}
          </Text>
        </Animated.View>
      ) : null}
    </PRToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1000,
    maxWidth: '88%',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 14, fontWeight: '600' },
});
