import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { initDatabase } from '@/db/database';
import { useAuthStore } from '@/store/auth.store';
import { useWorkoutStore } from '@/store/workout.store';
import { syncService } from '@/sync/sync.service';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };
SplashScreen.preventAutoHideAsync();
export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const colorScheme = useColorScheme();
  useEffect(() => {
    (async () => {
      await initDatabase();
      await useAuthStore.getState().initialize();
      await useWorkoutStore.getState().loadActiveWorkout();
      syncService.initialize();
      setReady(true);
      SplashScreen.hideAsync();
    })();
    return () => syncService.cleanup();
  }, []);
  if (!ready) return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colorScheme === 'dark' ? '#000' : '#fff' }}>
        <ActivityIndicator size="large" color={Colors[colorScheme ?? 'light'].tint} />
      </View>
    </GestureHandlerRootView>
  );
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
  }, [isAuthenticated, isLoading, segments]);
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack><Stack.Screen name="(auth)" options={{ headerShown: false }} /><Stack.Screen name="(tabs)" options={{ headerShown: false }} /><Stack.Screen name="workout" options={{ headerShown: false }} /><Stack.Screen name="+not-found" /></Stack>
    </ThemeProvider>
  );
}
