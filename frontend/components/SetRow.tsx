import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, Modal } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTimerStore } from '@/store/timer.store';
import { useUnitStore } from '@/store/unit.store';
import { C } from '@/constants/Colors';
import type { SetData } from '@/types';

interface Props {
  set: SetData;
  setNumber: number;
  previousSet?: SetData;
  onUpdate: (data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void;
  onDelete: () => void;
  onCycleSetType?: () => void; // Deprecated by local modal but kept for prop compat
  isDark?: boolean;
}

export function SetRow({ set, setNumber, previousSet, onUpdate, onDelete, isDark = false }: Props) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [showTypeSelector, setShowTypeSelector] = useState(false);

  const c = isDark ? C.dark : C.light;
  const unit = useUnitStore((state) => state.unit);
  const completionAnim = useRef(new Animated.Value(set.isCompleted ? 1 : 0)).current;

  useEffect(() => {
    setWeight(set.weight?.toString() ?? '');
    setReps(set.reps?.toString() ?? '');
  }, [set.weight, set.reps]);

  useEffect(() => {
    Animated.spring(completionAnim, {
      toValue: set.isCompleted ? 1 : 0,
      speed: 22,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  }, [completionAnim, set.isCompleted]);

  const handleWeight = (v: string) => { setWeight(v); const n = v ? parseFloat(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ weight: n }); };
  const handleReps = (v: string) => { setReps(v); const n = v ? parseInt(v) : null; if (v === '' || !isNaN(n!)) onUpdate({ reps: n }); };
  
  const { startTimer } = useTimerStore();
  const toggleComplete = () => {
    const willComplete = !set.isCompleted;
    onUpdate({ isCompleted: willComplete });
    if (willComplete) startTimer(60); // Default 60s rest
  };

  // Interpret exact set type
  const isW = set.isWarmup;
  const isD = set.isDropset;
  const isF = set.isFailure;
  const isN = !isW && !isD && !isF;

  // Derive styling
  let badgeText = isW ? 'W' : (isD ? 'D' : (isF ? 'F' : setNumber.toString()));
  let badgeColor = c.surfaceElevated;
  let badgeTextColor = c.textSecondary;
  let rowBg = 'transparent';

  if (isW) { badgeColor = c.warmupSoft; badgeTextColor = c.warmup; rowBg = c.warmupSoft; }
  else if (isD) { badgeColor = c.dropSetSoft; badgeTextColor = c.dropSet; rowBg = c.dropSetSoft; }
  else if (isF) { badgeColor = c.dangerSoft; badgeTextColor = c.danger; rowBg = c.dangerSoft; }

  // Overrides if completed
  if (set.isCompleted) {
    rowBg = c.successSoft;
  }

  const prevTextStr = previousSet && previousSet.weight && previousSet.reps 
    ? `${previousSet.weight}x${previousSet.reps}` 
    : '–';

  const checkScale = completionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1],
  });
  const checkOpacity = completionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 1],
  });

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
        {/* Set Badge */}
        <TouchableOpacity style={[styles.badge, { backgroundColor: badgeColor }]} onPress={() => setShowTypeSelector(true)} activeOpacity={0.6}>
          <Text style={[styles.badgeText, { color: badgeTextColor }]}>{badgeText}</Text>
        </TouchableOpacity>

        {/* Previous text (ghosted) */}
        <View style={styles.prevWrap}>
          <Text style={[styles.prevText, { color: c.textGhost }]} numberOfLines={1}>
            {prevTextStr}
          </Text>
        </View>

        {/* Inputs */}
        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { backgroundColor: set.isCompleted ? 'transparent' : c.surfaceElevated, color: c.text }]}
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
            style={[styles.input, { backgroundColor: set.isCompleted ? 'transparent' : c.surfaceElevated, color: c.text }]}
            value={reps}
            onChangeText={handleReps}
            placeholder="Reps"
            placeholderTextColor={c.textTertiary}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>

        {/* Checkmark Complete */}
        <TouchableOpacity
          style={[styles.checkBtn, { backgroundColor: set.isCompleted ? c.success : c.surfaceElevated }]}
          onPress={toggleComplete}
          activeOpacity={0.7}
        >
          <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkOpacity }}>
            <FontAwesome name="check" size={12} color={set.isCompleted ? '#fff' : c.textTertiary} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* Set Type Modal */}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 12,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '800',
  },
  prevWrap: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    height: 40,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  checkBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteWrap: {
    width: 75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 16,
  },
  modalIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOptionText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
