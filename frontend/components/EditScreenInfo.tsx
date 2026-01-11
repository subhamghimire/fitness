import { StyleSheet, View, Text } from 'react-native';
import { useColorScheme } from './useColorScheme';
import Colors from '@/constants/Colors';
export default function EditScreenInfo({ path }: { path: string }) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.text }]}>Open up the code for this screen:</Text>
      <View style={styles.pathContainer}><Text style={[styles.pathText, { color: colors.tint }]}>{path}</Text></View>
    </View>
  );
}
const styles = StyleSheet.create({ container: { alignItems: 'center', marginHorizontal: 50 }, text: { fontSize: 17, lineHeight: 24, textAlign: 'center' }, pathContainer: { marginTop: 8, borderRadius: 3, paddingHorizontal: 4 }, pathText: { fontFamily: 'monospace' } });
