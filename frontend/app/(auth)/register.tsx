import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { FontAwesome } from '@expo/vector-icons';
import { useAuthStore } from '@/store/auth.store';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

WebBrowser.maybeCompleteAuthSession();

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { register, loginWithGoogle, isLoading } = useAuthStore();
  const router = useRouter();
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;
  const isGoogleConfigured = Boolean(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID &&
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID &&
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  );
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });

  const handleRegister = async () => {
    if (!email.trim() || !password.trim() || !confirm.trim()) { Alert.alert('Error', 'Fill in all fields'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { Alert.alert('Error', 'Invalid email address'); return; }
    if (password.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    if (password !== confirm) { Alert.alert('Error', 'Passwords do not match'); return; }
    try { await register(email.trim(), password); router.replace('/(tabs)'); }
    catch (err: any) { Alert.alert('Registration Failed', err.message || 'Please try again'); }
  };

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params?.id_token;
    if (!idToken) {
      Alert.alert('Google Sign-Up Failed', 'Could not get Google ID token.');
      return;
    }

    (async () => {
      try {
        await loginWithGoogle(idToken);
        router.replace('/(tabs)');
      } catch (err: any) {
        Alert.alert('Google Sign-Up Failed', err.message || 'Please try again.');
      }
    })();
  }, [response]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>
          {/* Brand */}
          <View style={styles.brand}>
            <View style={[styles.logoBox, { backgroundColor: c.accent }]}>
              <Text style={styles.logoEmoji}>⚡</Text>
            </View>
            <Text style={[styles.logoTitle, { color: c.text }]}>Fitness</Text>
            <Text style={[styles.logoSub, { color: c.textSecondary }]}>Create your account</Text>
          </View>

          {/* Card form */}
          <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>Get started</Text>

            <View style={styles.fields}>
              {[
                { label: 'Email', value: email, onSet: setEmail, type: 'email-address', content: 'emailAddress', secure: false, hint: undefined },
                { label: 'Password', value: password, onSet: setPassword, type: 'default', content: 'newPassword', secure: true, hint: 'At least 6 characters' },
                { label: 'Confirm Password', value: confirm, onSet: setConfirm, type: 'default', content: 'newPassword', secure: true, hint: undefined },
              ].map((f) => (
                <View key={f.label} style={styles.field}>
                  <Text style={[styles.label, { color: c.textSecondary }]}>{f.label}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: c.surfaceElevated, color: c.text, borderColor: c.border }]}
                    placeholder={f.label}
                    placeholderTextColor={c.textTertiary}
                    value={f.value}
                    onChangeText={f.onSet}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={f.type as any}
                    textContentType={f.content as any}
                    secureTextEntry={f.secure}
                    editable={!isLoading}
                  />
                  {f.hint && <Text style={[styles.hint, { color: c.textTertiary }]}>{f.hint}</Text>}
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.cta, { backgroundColor: c.accent, opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleRegister}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Create Account</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.googleBtn, { backgroundColor: c.surfaceElevated, borderColor: c.border, opacity: isLoading ? 0.65 : 1 }]}
              onPress={() => {
                if (!isGoogleConfigured) {
                  Alert.alert('Google Sign-Up Not Configured', 'Please set Google client IDs in frontend .env first.');
                  return;
                }
                promptAsync();
              }}
              disabled={isLoading || !request || !isGoogleConfigured}
              activeOpacity={0.85}
            >
              <FontAwesome name="google" size={16} color={c.text} />
              <Text style={[styles.googleBtnText, { color: c.text }]}>Continue With Google</Text>
            </TouchableOpacity>
          </View>

          {/* Footer */}
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
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48, gap: 28 },
  brand: { alignItems: 'center', gap: 10 },
  logoBox: { width: 72, height: 72, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6C63FF', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  logoEmoji: { fontSize: 36 },
  logoTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -1 },
  logoSub: { fontSize: 15, fontWeight: '500' },
  card: { borderRadius: 20, borderWidth: 1, padding: 24, gap: 20,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 3,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  fields: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  input: { height: 50, borderRadius: 13, paddingHorizontal: 16, fontSize: 16, borderWidth: 1 },
  hint: { fontSize: 12, fontWeight: '500' },
  cta: { height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6C63FF', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  googleBtn: {
    height: 50,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
  },
  googleBtnText: { fontSize: 15, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14, fontWeight: '500' },
  footerLink: { fontSize: 14, fontWeight: '700' },
});
