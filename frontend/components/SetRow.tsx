import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Modal,
  Keyboard,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTimerStore } from '@/store/timer.store';
import { C } from '@/constants/Colors';
import type { SetData } from '@/types';

interface Props {
  set: SetData;
  setNumber: number;
  previousSet?: SetData;
  restSeconds?: number;
  onUpdate: (data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => void;
  onDelete: () => void;
  onCycleSetType?: () => void;
  isDark?: boolean;
}

function SetRowComponent({
  set,
  setNumber,
  previousSet,
  restSeconds = 90,
  onUpdate,
  onDelete,
  isDark = false,
}: Props) {
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [completed, setCompleted] = useState(!!set.isCompleted);

  const c = isDark ? C.dark : C.light;
  const startTimer = useTimerStore((s) => s.startTimer);
  const completionAnim = useRef(new Animated.Value(completed ? 1 : 0)).current;
  const weightCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repsCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setWeight(set.weight?.toString() ?? '');
  }, [set.weight]);

  useEffect(() => {
    setReps(set.reps?.toString() ?? '');
  }, [set.reps]);

  useEffect(() => {
    setCompleted(!!set.isCompleted);
  }, [set.isCompleted]);

  useEffect(() => {
    Animated.timing(completionAnim, {
      toValue: completed ? 1 : 0,
      duration: 120,
      useNativeDriver: true,
    }).start();
  }, [completionAnim, completed]);

  useEffect(() => {
    return () => {
      if (weightCommitRef.current) clearTimeout(weightCommitRef.current);
      if (repsCommitRef.current) clearTimeout(repsCommitRef.current);
    };
  }, []);

  const commitWeight = useCallback(
    (v: string) => {
      const n = v === '' ? null : parseFloat(v);
      if (v === '' || !Number.isNaN(n!)) {
        if (n !== set.weight) onUpdate({ weight: n });
      }
    },
    [onUpdate, set.weight]
  );

  const commitReps = useCallback(
    (v: string) => {
      const n = v === '' ? null : parseInt(v, 10);
      if (v === '' || !Number.isNaN(n!)) {
        if (n !== set.reps) onUpdate({ reps: n });
      }
    },
    [onUpdate, set.reps]
  );

  const handleWeight = (v: string) => {
    setWeight(v);
    if (weightCommitRef.current) clearTimeout(weightCommitRef.current);
    weightCommitRef.current = setTimeout(() => commitWeight(v), 280);
  };

  const handleReps = (v: string) => {
    setReps(v);
    if (repsCommitRef.current) clearTimeout(repsCommitRef.current);
    repsCommitRef.current = setTimeout(() => commitReps(v), 280);
  };

  const flushWeight = () => {
    if (weightCommitRef.current) {
      clearTimeout(weightCommitRef.current);
      weightCommitRef.current = null;
    }
    commitWeight(weight);
  };

  const flushReps = () => {
    if (repsCommitRef.current) {
      clearTimeout(repsCommitRef.current);
      repsCommitRef.current = null;
    }
    commitReps(reps);
  };

  const toggleComplete = () => {
    const willComplete = !completed;
    setCompleted(willComplete);
    onUpdate({ isCompleted: willComplete });
    if (willComplete) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      Keyboard.dismiss();
      startTimer(restSeconds);
    } else {
      void Haptics.selectionAsync();
    }
  };

  const isW = set.isWarmup;
  const isD = set.isDropset;
  const isF = set.isFailure;

  let badgeText = isW ? 'W' : isD ? 'D' : isF ? 'F' : String(setNumber);
  let badgeColor = c.surfaceElevated;
  let badgeTextColor = c.textSecondary;
  let rowBg = 'transparent';

  if (isW) {
    badgeColor = c.warmupSoft;
    badgeTextColor = c.warmup;
  } else if (isD) {
    badgeColor = c.dropSetSoft;
    badgeTextColor = c.dropSet;
  } else if (isF) {
    badgeColor = c.dangerSoft;
    badgeTextColor = c.danger;
  }

  if (completed) rowBg = c.successSoft;

  const prevTextStr =
    previousSet && (previousSet.weight != null || previousSet.reps != null)
      ? `${previousSet.weight ?? '–'} × ${previousSet.reps ?? '–'}`
      : '–';

  const checkScale = completionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  const renderRightActions = (_: unknown, dragX: Animated.AnimatedInterpolation<number>) => {
    const scale = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.6], extrapolate: 'clamp' });
    return (
      <TouchableOpacity
        onPress={() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onDelete();
        }}
        style={[styles.deleteWrap, { backgroundColor: c.dangerSoft }]}
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center', gap: 2 }}>
          <FontAwesome name="trash-o" size={15} color={c.danger} />
          <Text style={[styles.deleteText, { color: c.danger }]}>Delete</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const pickType = (data: Partial<Omit<SetData, 'id' | 'exerciseId'>>) => {
    onUpdate(data);
    setShowTypeSelector(false);
    void Haptics.selectionAsync();
  };

  return (
    <Swipeable renderRightActions={renderRightActions} friction={2} rightThreshold={40} overshootRight={false}>
      <View style={[styles.row, { backgroundColor: rowBg }]}>
        <TouchableOpacity
          style={[styles.badge, { backgroundColor: badgeColor }]}
          onPress={() => setShowTypeSelector(true)}
          activeOpacity={0.65}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <Text style={[styles.badgeText, { color: badgeTextColor }]}>{badgeText}</Text>
        </TouchableOpacity>

        <View style={styles.prevWrap}>
          <Text style={[styles.prevText, { color: c.textTertiary }]} numberOfLines={1}>
            {prevTextStr}
          </Text>
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: completed ? 'transparent' : c.surfaceElevated,
                color: c.text,
              },
            ]}
            value={weight}
            onChangeText={handleWeight}
            onBlur={flushWeight}
            onEndEditing={flushWeight}
            placeholder="–"
            placeholderTextColor={c.textTertiary}
            keyboardType="decimal-pad"
            selectTextOnFocus
            returnKeyType="next"
          />
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: completed ? 'transparent' : c.surfaceElevated,
                color: c.text,
              },
            ]}
            value={reps}
            onChangeText={handleReps}
            onBlur={flushReps}
            onEndEditing={flushReps}
            placeholder="–"
            placeholderTextColor={c.textTertiary}
            keyboardType="number-pad"
            selectTextOnFocus
            returnKeyType="done"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.checkBtn,
            {
              backgroundColor: completed ? c.success : 'transparent',
              borderColor: completed ? c.success : c.border,
            },
          ]}
          onPress={toggleComplete}
          activeOpacity={0.65}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Animated.View style={{ transform: [{ scale: checkScale }] }}>
            <FontAwesome name="check" size={12} color={completed ? '#fff' : c.textTertiary} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showTypeSelector} animationType="fade" onRequestClose={() => setShowTypeSelector(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowTypeSelector(false)}>
          <View style={[styles.modalContent, { backgroundColor: c.surface }]}>
            <Text style={[styles.modalTitle, { color: c.textSecondary }]}>Set type</Text>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => pickType({ isWarmup: false, isDropset: false, isFailure: false })}
            >
              <Text style={[styles.modalOptionText, { color: c.text }]}>Normal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => pickType({ isWarmup: true, isDropset: false, isFailure: false })}
            >
              <Text style={[styles.modalOptionText, { color: c.warmup }]}>Warmup</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => pickType({ isWarmup: false, isDropset: true, isFailure: false })}
            >
              <Text style={[styles.modalOptionText, { color: c.dropSet }]}>Drop set</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => pickType({ isWarmup: false, isDropset: false, isFailure: true })}
            >
              <Text style={[styles.modalOptionText, { color: c.danger }]}>Failure</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Swipeable>
  );
}

export const SetRow = memo(SetRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    gap: 10,
  },
  badge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  prevWrap: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevText: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  inputWrap: {
    flex: 1,
  },
  input: {
    height: 38,
    borderRadius: 10,
    textAlign: 'center',
    paddingHorizontal: 6,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  checkBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteWrap: {
    width: 80,
    marginVertical: 4,
    marginRight: 8,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  modalTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  modalOptionText: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
});
