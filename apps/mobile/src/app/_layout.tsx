import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" options={{ title: 'Collab' }} />
        <Stack.Screen name="link-test" options={{ title: 'Liên kết sâu' }} />
        <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
