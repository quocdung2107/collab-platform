import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Kiểm thử DB dùng chung một cơ sở dữ liệu nên chạy tuần tự.
    fileParallelism: false,
  },
});
