import { errorText, useLoad, useRealtime } from '@collab/client';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { appleAvailable, signInWithApple, signInWithGoogle, signOut } from '@/lib/auth';
import { registerForPush, sendTestPush, type PushRegistration } from '@/lib/push';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useTheme, type Theme } from '@/lib/theme';

/**
 * Màn hình thử nghiệm M0 (AD-35): kiểm tra trên máy thật năm điều trước khi viết lại giao diện —
 * đăng nhập Google, Sign in with Apple, gọi API, Realtime (AD-31), push qua Expo, liên kết sâu.
 * M2 thay màn hình này bằng khung 4 tab.
 */
export default function Home() {
  const session = useSession();
  const t = useTheme();
  if (session === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.page}>
      {session ? <Checks t={t} userId={session.user.id} /> : <SignIn t={t} />}
    </ScrollView>
  );
}

function SignIn({ t }: { t: Theme }) {
  const [apple, setApple] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void appleAvailable().then(setApple), []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.gap}>
      <Text style={[styles.h1, { color: t.text }]}>Đăng nhập</Text>
      <Button t={t} label="Tiếp tục với Google" disabled={busy} onPress={() => run(signInWithGoogle)} />
      {apple && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={{ height: 48 }}
          onPress={() => run(signInWithApple)}
        />
      )}
      {error && <Text style={{ color: t.danger }}>{error}</Text>}
    </View>
  );
}

function Checks({ t, userId }: { t: Theme; userId: string }) {
  const me = useLoad(() => api.me(), []);
  const [signals, setSignals] = useState(0);
  useRealtime(supabase, [`user:${userId}`], () => {
    setSignals((n) => n + 1);
    me.reload();
  });
  const [push, setPush] = useState<PushRegistration | null>(null);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [lastTap, setLastTap] = useState<string | null>(null);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => setLastTap(JSON.stringify(r.notification.request.content.data)));
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.gap}>
      <Text style={[styles.h1, { color: t.text }]}>Kiểm tra M0</Text>
      <Row t={t} label="Đăng nhập + API /v1/me" ok={!!me.data} detail={me.data ? `${me.data.user.displayName} · ${me.data.memberships.length} tổ chức` : (me.error ?? 'Đang tải… (máy chủ Render có thể đang thức dậy)')} />
      <Row t={t} label="Realtime user:{id}" ok={signals > 0} detail={`${signals} tín hiệu. Thử: nhờ người khác thêm/gỡ bạn khỏi một nhóm.`} />
      <Row t={t} label="Push token" ok={!!push && 'token' in push} detail={push ? ('token' in push ? push.token : push.error) : 'Chưa xin quyền'} />
      <Button t={t} label="Bật thông báo" onPress={() => void registerForPush().then(setPush)} />
      {push && 'token' in push && (
        <Button
          t={t}
          label="Gửi thông báo thử"
          onPress={() =>
            void sendTestPush(push.token).then(
              (r) => setPushResult(JSON.stringify(r)),
              (e: unknown) => setPushResult(errorText(e)),
            )
          }
        />
      )}
      {pushResult && <Text style={[styles.small, { color: t.muted }]}>{pushResult}</Text>}
      <Row t={t} label="Chạm vào thông báo" ok={!!lastTap} detail={lastTap ?? 'Chưa có'} />
      <Row t={t} label="Liên kết sâu" ok={false} detail="Mở collab://link-test?from=zalo trong Safari hoặc gửi qua Zalo rồi bấm." />
      <Button t={t} label="Đăng xuất" onPress={() => void signOut()} />
    </View>
  );
}

function Row({ t, label, ok, detail }: { t: Theme; label: string; ok: boolean; detail: string }) {
  return (
    <View style={[styles.row, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={{ color: ok ? t.ok : t.muted, fontWeight: '600' }}>{ok ? '✓ ' : '○ '}{label}</Text>
      <Text selectable style={[styles.small, { color: t.muted }]}>{detail}</Text>
    </View>
  );
}

function Button({ t, label, onPress, disabled }: { t: Theme; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: t.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 48 },
  gap: { gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  small: { fontSize: 13 },
  btn: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
