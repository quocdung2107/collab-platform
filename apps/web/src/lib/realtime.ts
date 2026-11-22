import { useRealtime as useSharedRealtime } from '@collab/client';
import { supabase } from './supabase';

/** Realtime (AD-31) dùng chung, gắn với Supabase client của trình duyệt. */
export const useRealtime = (topics: string[], onChange: () => void) => useSharedRealtime(supabase, topics, onChange);
