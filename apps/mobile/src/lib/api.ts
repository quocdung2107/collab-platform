import { createApi } from '@collab/client';
import { randomUUID } from 'expo-crypto';
import { config } from './config';
import { supabase } from './supabase';

/** Lớp API dùng chung (packages/client) gắn với phiên Supabase của app. Hermes không có crypto.randomUUID. */
export const api = createApi({
  baseUrl: config.apiUrl,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token,
  newId: randomUUID,
});
