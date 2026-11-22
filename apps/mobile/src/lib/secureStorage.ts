import * as SecureStore from 'expo-secure-store';

/**
 * Nơi lưu phiên Supabase trên máy: Keychain (iOS) / Keystore (Android) qua expo-secure-store.
 * Một số bản iOS từ chối giá trị > ~2048 byte, còn phiên Supabase thường lớn hơn → chia thành nhiều mảnh.
 * Mảnh 0 lưu số mảnh; đọc thiếu mảnh nào thì coi như chưa có phiên (đăng nhập lại), không đoán.
 */
const CHUNK = 1800;
const safeKey = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

export const chunkedSecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const p = await SecureStore.getItemAsync(`${k}.${i}`);
      if (p === null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    const old = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
    const count = Math.ceil(value.length / CHUNK) || 1;
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${k}.n`, String(count));
    for (let i = count; i < old; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
    await SecureStore.deleteItemAsync(`${k}.n`);
  },
};
