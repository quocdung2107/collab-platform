import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  WEB_ORIGINS: z.string().default('http://localhost:5173'),
  PORT: z.coerce.number().int().positive().default(8080),
  // supabase: realtime.send() trong giao dịch (AD-31). none: bỏ qua (Postgres thường, chạy cục bộ).
  REALTIME_DRIVER: z.enum(['supabase', 'none']).default('supabase'),
});

export interface Config {
  databaseUrl: string;
  supabaseUrl: string;
  webOrigins: string[];
  port: number;
  realtimeDriver: 'supabase' | 'none';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Cấu hình thiếu hoặc sai: ${fields}. Xem apps/api/.env.example`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    supabaseUrl: e.SUPABASE_URL.replace(/\/+$/, ''),
    webOrigins: e.WEB_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    port: e.PORT,
    realtimeDriver: e.REALTIME_DRIVER,
  };
}
