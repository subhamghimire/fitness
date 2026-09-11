import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';
import { GoogleSignInButton, isGoogleAuthConfigured } from '@/components/GoogleSignInButton';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loginWithGoogle, isLoading } = useAuthStore();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const googleEnabled = isGoogleAuthConfigured();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please check your credentials';
      Alert.alert('Login Failed', message);
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
          <View style={styles.brand}>
            <View style={[styles.logoBox, { backgroundColor: c.accent }]}>
              <FontAwesome name="bolt" size={32} color="#fff" />
            </View>
            <Text style={[styles.logoTitle, { color: c.text }]}>Fitness</Text>
            <Text style={[styles.logoSub, { color: c.textSecondary }]}>Your personal workout journal</Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Welcome back</Text>

            <View style={styles.fields}>
              <View style={styles.field}>
                <Text style={[styles.label, { color: c.textSecondary }]}>Email</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: c.surfaceElevated, color: c.text, borderColor: c.border },
                  ]}
                  placeholder="you@example.com"
                  placeholderTextColor={c.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!isLoading}
                />
              </View>

              <View style={styles.field}>
                <Text style={[styles.label, { color: c.textSecondary }]}>Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    { backgroundColor: c.surfaceElevated, color: c.text, borderColor: c.border },
                  ]}
                  placeholder="••••••••"
                  placeholderTextColor={c.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  editable={!isLoading}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.cta, { backgroundColor: c.accent, opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>Sign In</Text>
              )}
            </TouchableOpacity>

            {googleEnabled ? (
              <GoogleSignInButton
                onSuccess={handleGoogleSuccess}
                disabled={isLoading}
                isDark={isDark}
              />
            ) : null}
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: c.textSecondary }]}>Don't have an account? </Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity disabled={isLoading}>
                <Text style={[styles.footerLink, { color: c.accent }]}>Sign Up</Text>
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
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48, gap: 28 },
  brand: { alignItems: 'center', gap: 10 },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  logoSub: { fontSize: 15, fontWeight: '500' },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 20,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  fields: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  input: {
    height: 50,
    borderRadius: 13,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  cta: {
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14, fontWeight: '500' },
  footerLink: { fontSize: 14, fontWeight: '700' },
});
