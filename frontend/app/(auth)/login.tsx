import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('Error', 'Please enter email and password'); return; }
    try { await login(email.trim(), password); router.replace('/(tabs)'); }
    catch (err: any) { Alert.alert('Login Failed', err.message || 'Please check your credentials'); }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <View style={styles.inner}>
        {/* Brand */}
        <View style={styles.brand}>
          <View style={[styles.logoBox, { backgroundColor: c.accent }]}>
            <Text style={styles.logoEmoji}>⚡</Text>
          </View>
          <Text style={[styles.logoTitle, { color: c.text }]}>Fitness</Text>
          <Text style={[styles.logoSub, { color: c.textSecondary }]}>Your personal workout journal</Text>
        </View>

        {/* Card */}
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>Welcome back</Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: c.textSecondary }]}>Email</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text, borderColor: c.border }]}
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
                style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text, borderColor: c.border }]}
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
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: c.textSecondary }]}>Don't have an account? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity disabled={isLoading}>
              <Text style={[styles.footerLink, { color: c.accent }]}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 28 },
  brand: { alignItems: 'center', gap: 10 },
  logoBox: { width: 72, height: 72, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6C63FF', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  logoEmoji: { fontSize: 36 },
  logoTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  logoSub: { fontSize: 15, fontWeight: '500' },
  card: {
    borderRadius: 20, borderWidth: 1, padding: 24, gap: 20,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 3,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  fields: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  input: {
    height: 50, borderRadius: 13, paddingHorizontal: 16, fontSize: 16, borderWidth: 1,
  },
  cta: {
    height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6C63FF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14, fontWeight: '500' },
  footerLink: { fontSize: 14, fontWeight: '700' },
});
