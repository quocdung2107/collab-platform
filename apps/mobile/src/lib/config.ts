import Constants from 'expo-constants';

interface Extra {
  apiUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  linkDomain: string;
  eas?: { projectId?: string };
}

/** Giá trị công khai từ app.config.ts (extra). */
export const config = Constants.expoConfig?.extra as Extra;
export const easProjectId = config.eas?.projectId ?? Constants.easConfig?.projectId;
