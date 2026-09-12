import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { initDatabase } from '@/db/database';
import { useAuthStore } from '@/store/auth.store';
import { useThemeStore } from '@/store/theme.store';
import { useUnitStore } from '@/store/unit.store';
import { usePreferencesStore } from '@/store/preferences.store';
import { useWorkoutStore } from '@/store/workout.store';
import { syncService } from '@/sync/sync.service';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text, View, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();

function WebUnsupportedScreen() {
  const colorScheme = useColorScheme();
  const bg = colorScheme === 'dark' ? '#0B0B0F' : '#F7F7F8';
  const text = colorScheme === 'dark' ? '#F5F5F7' : '#111118';
  const muted = colorScheme === 'dark' ? '#A0A0B0' : '#6B6B7B';

  return (
    <View style={[styles.webWrap, { backgroundColor: bg }]}>
      <Text style={[styles.webTitle, { color: text }]}>Mobile only</Text>
      <Text style={[styles.webBody, { color: muted }]}>
        This fitness app uses on-device storage and needs to run on iOS or Android.
      </Text>
      <Text style={[styles.webHint, { color: muted }]}>
        From the project folder:{'\n'}
        npx expo run:android{'  '}or{'  '}npx expo run:ios
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (Platform.OS === 'web') {
      SplashScreen.hideAsync();
      setReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await useThemeStore.getState().initialize();
        await useUnitStore.getState().initialize();
        await usePreferencesStore.getState().initialize();
        await initDatabase();
        await useAuthStore.getState().initialize();
        await useWorkoutStore.getState().loadActiveWorkout();
        syncService.initialize();
        if (!cancelled) setReady(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start app';
        if (!cancelled) setBootError(message);
      } finally {
        SplashScreen.hideAsync();
      }
    })();

    return () => {
      cancelled = true;
      syncService.cleanup();
    };
  }, []);

  if (Platform.OS === 'web') {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <WebUnsupportedScreen />
      </GestureHandlerRootView>
    );
  }

  if (bootError) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.webWrap, { backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }]}>
          <Text style={[styles.webTitle, { color: colorScheme === 'dark' ? '#fff' : '#111' }]}>
            Couldn’t start
          </Text>
          <Text style={[styles.webBody, { color: colorScheme === 'dark' ? '#aaa' : '#666' }]}>
            {bootError}
          </Text>
        </View>
      </GestureHandlerRootView>
    );
  }

  if (!ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colorScheme === 'dark' ? '#000' : '#fff',
          }}
        >
          <ActivityIndicator size="large" color={Colors[colorScheme ?? 'light'].tint} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RootLayoutNav />
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isAuthenticated, isLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuth) router.replace('/(auth)/login');
    else if (isAuthenticated && inAuth) router.replace('/(tabs)');
  }, [isAuthenticated, isLoading, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerTitleAlign: 'center' }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="workout" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  webWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  webTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  webBody: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
    maxWidth: 420,
  },
  webHint: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: Platform.select({ web: 'monospace', default: undefined }),
  },
});
