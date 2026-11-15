import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Kiểm thử chạy thẳng mã nguồn của gói shared (bản build dist chỉ dùng khi chạy production).
  resolve: { alias: { '@collab/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Kiểm thử DB dùng chung một cơ sở dữ liệu nên chạy tuần tự.
    fileParallelism: false,
  },
});
