import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { easProjectId } from './config';

// Khi app đang mở vẫn hiện banner (NOTIFICATION_ENGINE: không mất thông báo action_required).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export type PushRegistration = { token: string } | { error: string };

/**
 * Xin quyền và lấy Expo push token. Cần development build (không phải Expo Go), máy thật,
 * và EAS project id. M3 sẽ gửi token này lên /v1/push/devices (kind = 'expo').
 */
export async function registerForPush(): Promise<PushRegistration> {
  if (!Device.isDevice) return { error: 'Cần máy thật để nhận push.' };
  if (!easProjectId) return { error: 'Chưa có EAS project id (chạy `eas init`).' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Mặc định', importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { error: 'Bạn chưa cho phép thông báo.' };
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
  return { token: data };
}

/** Thử nghiệm M0: tự gửi một push qua Expo Push API tới chính máy này (không qua backend). */
export async function sendTestPush(token: string) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: token, title: 'Collab', body: 'Thông báo thử M0', data: { route: { kind: 'event', id: 'test' } } }),
  });
  return (await res.json()) as unknown;
}
