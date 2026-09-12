import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { GroupedRow } from '@/components/ui/GroupedRow';
import { GroupedSection } from '@/components/ui/GroupedSection';
import { NativeTextField } from '@/components/ui/NativeTextField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { apiErrorMessage } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import type { Gender } from '@/types';

const GENDERS: { key: Gender; label: string }[] = [
  { key: 'male', label: 'Male' },
  { key: 'female', label: 'Female' },
  { key: 'other', label: 'Other' },
];

export default function EditProfileScreen() {
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [age, setAge] = useState(user?.age != null ? String(user.age) : '');
  const [gender, setGender] = useState<Gender | null>(user?.gender ?? null);
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  const handleSave = async () => {
    if (!canSave) {
      Alert.alert('Name required', 'Enter a display name so your profile is yours.');
      return;
    }
    const parsedAge = age.trim() === '' ? null : Number.parseInt(age, 10);
    if (parsedAge !== null && (Number.isNaN(parsedAge) || parsedAge < 13 || parsedAge > 120)) {
      Alert.alert('Invalid age', 'Age must be between 13 and 120.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        ...(parsedAge !== null ? { age: parsedAge } : {}),
        ...(gender ? { gender } : {}),
      });
      router.back();
    } catch (err: unknown) {
      Alert.alert('Save failed', apiErrorMessage(err, 'Could not save profile'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Avatar name={name || user?.name} email={user?.email} photoUrl={user?.photoUrl} size={88} />
          <Text style={[styles.email, { color: c.textSecondary }]}>{user?.email}</Text>
        </View>

        <View style={styles.fields}>
          <NativeTextField
            label="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            textContentType="name"
            placeholder="Your name"
          />
          <NativeTextField
            label="Age"
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="Optional"
          />
        </View>

        <GroupedSection title="Gender" footer="Used only on your profile. You can change this anytime.">
          {GENDERS.map((opt, index) => (
            <GroupedRow
              key={opt.key}
              label={opt.label}
              selected={gender === opt.key}
              last={index === GENDERS.length - 1}
              onPress={() => setGender(opt.key)}
            />
          ))}
        </GroupedSection>

        {gender ? (
          <TouchableOpacity onPress={() => setGender(null)} style={styles.clear}>
            <Text style={[styles.clearText, { color: c.textSecondary }]}>Clear gender</Text>
          </TouchableOpacity>
        ) : null}

        <PrimaryButton label="Save" onPress={handleSave} loading={saving} disabled={!canSave} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingTop: 24, paddingBottom: 40, gap: 22 },
  hero: { alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  email: { fontSize: 15 },
  fields: { paddingHorizontal: 16, gap: 14 },
  clear: { alignItems: 'center' },
  clearText: { fontSize: 15 },
});
