import type { ExpoConfig } from 'expo/config';

/**
 * Cấu hình app (AD-35). Mọi giá trị dưới đây đều công khai theo thiết kế (khoá publishable, URL API).
 * Biến môi trường ghi đè khi build (EAS env hoặc shell):
 * - API_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
 * - EAS_PROJECT_ID: lấy sau `eas init` (cần cho Expo push token)
 * - LINK_DOMAIN: tên miền cho Universal Links / App Links. Để trống cho tới khi mua tên miền;
 *   lúc đó app chỉ dùng scheme `collab://` (quyết định của chủ sản phẩm 22/11/2026).
 */
const BUNDLE_ID = 'com.quocdung2107.collab';
const linkDomain = process.env.LINK_DOMAIN?.trim() || '';
const projectId = process.env.EAS_PROJECT_ID?.trim() || undefined;

const config: ExpoConfig = {
  name: 'Collab',
  slug: 'collab',
  scheme: 'collab',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    usesAppleSignIn: true,
    ...(linkDomain ? { associatedDomains: [`applinks:${linkDomain}`] } : {}),
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Firebase (push Android): đặt tệp google-services.json cạnh app.config.ts khi đã tạo project Firebase.
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
    ...(linkDomain
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: linkDomain }],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  plugins: ['expo-router', 'expo-notifications', 'expo-apple-authentication', 'expo-secure-store', 'expo-sqlite'],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.API_URL || 'https://collab-api-jcwa.onrender.com',
    supabaseUrl: process.env.SUPABASE_URL || 'https://jgdbeutyiwyrgjirakvn.supabase.co',
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mQdyFM9SBcALt9LDmulCJg_qFX7xVO1',
    linkDomain,
    ...(projectId ? { eas: { projectId } } : {}),
  },
};

export default config;
