import React, { useState, useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import { formatDuration } from '@/utils/date';

interface Props {
  startTime: string;
  textColor?: string;
  fontSize?: number;
}

export function WorkoutTimer({ startTime, textColor = '#FFFFFF', fontSize = 18 }: Props) {
  const [duration, setDuration] = useState('0:00');

  useEffect(() => {
    setDuration(formatDuration(startTime));
    const i = setInterval(() => setDuration(formatDuration(startTime)), 1000);
    return () => clearInterval(i);
  }, [startTime]);

  return (
    <Text style={[styles.timer, { color: textColor, fontSize }]}>
      {duration}
    </Text>
  );
}

const styles = StyleSheet.create({
  timer: {
    fontWeight: '700',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
});
