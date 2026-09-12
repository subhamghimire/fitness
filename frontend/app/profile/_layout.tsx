import { Stack } from 'expo-router';
import { C } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function ProfileLayout() {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  return (
    <Stack
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: c.background },
        headerShadowVisible: false,
        headerTintColor: c.accent,
        headerTitleStyle: { color: c.text, fontSize: 17, fontWeight: '600' },
        contentStyle: { backgroundColor: c.background },
      }}
    >
      <Stack.Screen name="edit" options={{ title: 'Edit Profile' }} />
    </Stack>
  );
}
