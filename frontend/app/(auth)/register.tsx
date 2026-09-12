import React, { useCallback, useState } from 'react';
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
import { Link, useRouter } from 'expo-router';
import { NativeTextField } from '@/components/ui/NativeTextField';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { GoogleSignInButton, isGoogleAuthConfigured } from '@/components/GoogleSignInButton';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuthStore } from '@/store/auth.store';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { register, loginWithGoogle, isLoading } = useAuthStore();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const googleEnabled = isGoogleAuthConfigured();

  const handleRegister = async () => {
    if (!email.trim() || !password.trim() || !confirm.trim()) {
      Alert.alert('Missing fields', 'Fill in all fields.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Check the address and try again.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    try {
      await register(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please try again';
      Alert.alert('Registration Failed', message);
    }
  };

  const handleGoogleSuccess = useCallback(
    async (idToken: string) => {
      await loginWithGoogle(idToken);
      router.replace('/(tabs)');
    },
    [loginWithGoogle, router]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inner}>
          <Text style={[styles.title, { color: c.text }]}>Create Account</Text>

          <View style={styles.fields}>
            <NativeTextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!isLoading}
              placeholder="you@example.com"
            />
            <NativeTextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              editable={!isLoading}
              placeholder="At least 6 characters"
              hint="At least 6 characters"
            />
            <NativeTextField
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              textContentType="newPassword"
              editable={!isLoading}
              placeholder="Repeat password"
            />
          </View>

          <PrimaryButton label="Create Account" onPress={handleRegister} loading={isLoading} />

          {googleEnabled ? (
            <GoogleSignInButton onSuccess={handleGoogleSuccess} disabled={isLoading} isDark={isDark} />
          ) : null}

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: c.textSecondary }]}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={[styles.footerLink, { color: c.accent }]}>Sign In</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48, gap: 22 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
  fields: { gap: 14 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  footerText: { fontSize: 15 },
  footerLink: { fontSize: 15, fontWeight: '600' },
});
