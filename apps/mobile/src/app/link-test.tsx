import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

/** Thử nghiệm M0: mở collab://link-test?from=zalo từ Zalo/Safari để xem app có nhận liên kết không. */
export default function LinkTest() {
  const t = useTheme();
  const params = useLocalSearchParams();
  return (
    <View style={[styles.box, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.ok }]}>App đã mở từ liên kết</Text>
      <Text style={{ color: t.text }}>{JSON.stringify(params)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ box: { flex: 1, padding: 24, gap: 12 }, title: { fontSize: 20, fontWeight: '600' } });
