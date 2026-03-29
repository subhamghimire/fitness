import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

interface DataPoint {
  label: string; // MM/DD
  value: number; // Volume or Max Weight
}

interface Props {
  data: DataPoint[];
  colorHex?: string;
}

export function ProgressChart({ data, colorHex }: Props) {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const accentColor = colorHex || c.accent;

  const anims = useRef(data.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      50,
      anims.map(a => Animated.timing(a, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }))
    ).start();
  }, [anims]);

  if (data.length === 0) return null;

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const CHART_HEIGHT = 120;

  return (
    <View style={styles.container}>
      <View style={styles.chartArea}>
        {data.map((d, i) => {
          const heightRatio = d.value / maxVal;
          const targetHeight = heightRatio * CHART_HEIGHT;

          return (
            <View key={i} style={styles.barWrap}>
              <Animated.View 
                style={[
                  styles.bar, 
                  { 
                    backgroundColor: accentColor,
                    height: anims[i].interpolate({ inputRange: [0, 1], outputRange: [0, targetHeight] })
                  }
                ]} 
              />
              <Text style={[styles.label, { color: c.textSecondary }]}>{d.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 160,
    width: '100%',
    paddingTop: 20,
    paddingHorizontal: 8,
  },
  chartArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 24, // Space for labels
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  bar: {
    width: '80%',
    maxWidth: 24,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  label: {
    position: 'absolute',
    bottom: -20,
    fontSize: 10,
    fontWeight: '600',
  },
});
