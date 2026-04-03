import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Modal, Easing } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { C } from '@/constants/Colors';
import { useUnitStore } from '@/store/unit.store';
import type { TemplateSet } from '@/types';

interface Props {
  set: TemplateSet;
  setNumber: number;
  onUpdate: (data: Partial<Omit<TemplateSet, 'id' | 'templateExerciseId'>>) => void;
  onDelete: () => void;
  onCycleSetType?: () => void;
  isDark?: boolean;
}

export function TemplateSetRow({ set, setNumber, onUpdate, onDelete, isDark = false }: Props) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);

  useEffect(() => {
    setWeight(set.weight?.toString() ?? '');
    setReps(set.reps?.toString() ?? '');
  }, [set.weight, set.reps]);

  const handleWeight = (v: string) => { setWeight(v); const n = v ? parseFloat(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ weight: n }); };
  const handleReps = (v: string) => { setReps(v); const n = v ? parseInt(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ reps: n }); };
  const handleDisabledPreviousTap = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: -1, duration: 45, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 45, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -0.8, duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.8, duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 35, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  };

  const isW = set.isWarmup;
  const isD = set.isDropset;
  const isF = set.isFailure;

  let badgeText = isW ? 'W' : (isD ? 'D' : (isF ? 'F' : setNumber.toString()));
  let badgeColor = c.surfaceElevated;
  let badgeTextColor = c.textSecondary;
  let rowBg = 'transparent';

  if (isW) { badgeColor = c.warmupSoft; badgeTextColor = c.warmup; rowBg = c.warmupSoft; }
  else if (isD) { badgeColor = c.dropSetSoft; badgeTextColor = c.dropSet; rowBg = c.dropSetSoft; }
  else if (isF) { badgeColor = c.dangerSoft; badgeTextColor = c.danger; rowBg = c.dangerSoft; }

  const renderRightActions = (progress: any, dragX: any) => {
    const scale = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.5], extrapolate: 'clamp' });
    return (
      <TouchableOpacity onPress={onDelete} style={[styles.deleteWrap, { backgroundColor: c.danger }]}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <FontAwesome name="trash" size={18} color="#fff" />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable renderRightActions={renderRightActions} friction={2} rightThreshold={40} overshootRight={false}>
      <View style={[styles.row, { backgroundColor: rowBg }]}>
        <TouchableOpacity style={[styles.badge, { backgroundColor: badgeColor }]} onPress={() => setShowTypeSelector(true)} activeOpacity={0.6}>
          <Text style={[styles.badgeText, { color: badgeTextColor }]}>{badgeText}</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={1} onPress={handleDisabledPreviousTap}>
          <Animated.View
            style={[
              styles.prevWrap,
              {
                transform: [{
                  translateX: shake.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-6, 6],
                  }),
                }],
              },
            ]}
          >
            <Text style={[styles.prevText, { color: c.textGhost }]}>-</Text>
          </Animated.View>
        </TouchableOpacity>

        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text }]}
            value={weight}
            onChangeText={handleWeight}
            placeholder={unit.toUpperCase()}
            placeholderTextColor={c.textTertiary}
            keyboardType="decimal-pad"
            selectTextOnFocus
          />
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text }]}
            value={reps}
            onChangeText={handleReps}
            placeholder="Reps"
            placeholderTextColor={c.textTertiary}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>

        <View style={{ width: 34 }} />
      </View>

      <Modal transparent visible={showTypeSelector} animationType="fade" onRequestClose={() => setShowTypeSelector(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTypeSelector(false)}>
          <View style={[styles.modalContent, { backgroundColor: c.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: c.textSecondary }]}>Select Set Type</Text>
            
            <TouchableOpacity style={styles.modalOption} onPress={() => { onUpdate({ isWarmup: false, isDropset: false, isFailure: false }); setShowTypeSelector(false); }}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.surface }]}>
                <FontAwesome name="circle" size={14} color={c.text} />
              </View>
              <Text style={[styles.modalOptionText, { color: c.text }]}>Normal Set</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={() => { onUpdate({ isWarmup: true, isDropset: false, isFailure: false }); setShowTypeSelector(false); }}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.warmupSoft }]}>
                <FontAwesome name="fire" size={14} color={c.warmup} />
              </View>
              <Text style={[styles.modalOptionText, { color: c.text }]}>Warmup Set</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={() => { onUpdate({ isWarmup: false, isDropset: true, isFailure: false }); setShowTypeSelector(false); }}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.dropSetSoft }]}>
                <FontAwesome name="level-down" size={14} color={c.dropSet} />
              </View>
              <Text style={[styles.modalOptionText, { color: c.text }]}>Drop Set</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={() => { onUpdate({ isWarmup: false, isDropset: false, isFailure: true }); setShowTypeSelector(false); }}>
              <View style={[styles.modalIconWrap, { backgroundColor: c.dangerSoft }]}>
                <FontAwesome name="exclamation-triangle" size={12} color={c.danger} />
              </View>
              <Text style={[styles.modalOptionText, { color: c.text }]}>Failure</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16, gap: 12 },
  badge: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  badgeText: { fontSize: 14, fontWeight: '800' },
  prevWrap: { width: 60, alignItems: 'center', justifyContent: 'center' },
  prevText: { fontSize: 18, fontWeight: '600' },
  inputWrap: { flex: 1 },
  input: {
    height: 40,
    borderRadius: 12,
    textAlign: 'left',
    writingDirection: 'ltr',
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '700',
  },
  deleteWrap: { width: 75, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalContent: {
    width: '100%', borderRadius: 24, padding: 20, shadowColor: '#000', shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 10 }, shadowRadius: 20, elevation: 10,
  },
  modalTitle: {
    fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 16, textAlign: 'center',
  },
  modalOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 16 },
  modalIconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  modalOptionText: { fontSize: 17, fontWeight: '600' },
});
