import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { formatDuration } from '@/utils/date';
interface Props { startTime: string; textColor?: string; }
export function WorkoutTimer({ startTime, textColor = '#fff' }: Props) {
  const [duration, setDuration] = useState('0:00');
  useEffect(() => { setDuration(formatDuration(startTime)); const i = setInterval(() => setDuration(formatDuration(startTime)), 1000); return () => clearInterval(i); }, [startTime]);
  return <View style={styles.container}><Text style={[styles.duration, { color: textColor }]}>{duration}</Text></View>;
}
const styles = StyleSheet.create({ container: { alignItems: 'center' }, duration: { fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] } });
