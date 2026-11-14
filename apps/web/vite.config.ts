import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker ở bước này chỉ để ứng dụng cài được (Thêm vào Màn hình chính).
      // Web Push được thêm ở thử nghiệm OD-17.
      manifest: {
        name: 'Collab — Hội thánh',
        short_name: 'Collab',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f4e79',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { navigateFallbackDenylist: [/^\/auth\//] },
    }),
  ],
  server: { port: 5173 },
  test: { include: ['src/**/*.test.ts'] },
});
