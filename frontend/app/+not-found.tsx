import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { C } from '@/constants/Colors';

export default function NotFoundScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = isDark ? C.dark : C.light;

  return (
    <>
      <Stack.Screen options={{ title: 'Not found', headerTitleAlign: 'center' }} />
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <Text style={[styles.title, { color: c.text }]}>This screen doesn’t exist.</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={[styles.linkText, { color: c.accent }]}>Go home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  link: {
    marginTop: 16,
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
