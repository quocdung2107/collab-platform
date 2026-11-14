import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// VITE_BASE: đường dẫn gốc khi triển khai dưới thư mục con (GitHub Pages: /collab-platform/).
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // Service worker tự viết (src/sw.ts) để xử lý Web Push (OD-17); workbox chỉ dùng để precache.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Collab — Hội thánh',
        short_name: 'Collab',
        lang: 'vi',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f4e79',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg}'] },
    }),
  ],
  server: { port: 5173 },
  test: { include: ['src/**/*.test.ts'] },
});
