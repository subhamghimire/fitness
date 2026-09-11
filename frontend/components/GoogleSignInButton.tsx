import React, { useEffect } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { FontAwesome } from '@expo/vector-icons';
import { C } from '@/constants/Colors';

WebBrowser.maybeCompleteAuthSession();

type GoogleAuthConfig = {
  iosClientId?: string;
  androidClientId?: string;
  webClientId?: string;
};

/** Returns platform-specific Google OAuth config, or null when unavailable. */
export function getGoogleAuthConfig(): GoogleAuthConfig | null {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim();
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

  if (Platform.OS === 'android') {
    if (!androidClientId || !webClientId) return null;
    return { androidClientId, webClientId };
  }
  if (Platform.OS === 'ios') {
    if (!iosClientId || !webClientId) return null;
    return { iosClientId, webClientId };
  }
  if (!webClientId) return null;
  return { webClientId };
}

export function isGoogleAuthConfigured(): boolean {
  return getGoogleAuthConfig() != null;
}

interface Props {
  onSuccess: (idToken: string) => Promise<void>;
  disabled?: boolean;
  isDark?: boolean;
  label?: string;
}

/**
 * Only mount this when `isGoogleAuthConfigured()` is true.
 * The Google auth hook requires a valid client id for the current platform.
 */
export function GoogleSignInButton({
  onSuccess,
  disabled = false,
  isDark = false,
  label = 'Continue with Google',
}: Props) {
  const c = isDark ? C.dark : C.light;
  const config = getGoogleAuthConfig();

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: config?.iosClientId,
    androidClientId: config?.androidClientId,
    webClientId: config?.webClientId,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params?.id_token;
    if (!idToken) {
      Alert.alert('Google sign-in failed', 'Could not get Google ID token.');
      return;
    }
    void onSuccess(idToken).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Please try again.';
      Alert.alert('Google sign-in failed', message);
    });
  }, [response, onSuccess]);

  return (
    <TouchableOpacity
      style={[
        styles.googleBtn,
        { backgroundColor: c.surfaceElevated, borderColor: c.border, opacity: disabled ? 0.65 : 1 },
      ]}
      onPress={() => {
        void promptAsync();
      }}
      disabled={disabled || !request}
      activeOpacity={0.85}
    >
      {disabled ? (
        <ActivityIndicator color={c.text} />
      ) : (
        <>
          <FontAwesome name="google" size={16} color={c.text} />
          <Text style={[styles.googleBtnText, { color: c.text }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
});
