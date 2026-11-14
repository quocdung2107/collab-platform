# collab-platform

Nền tảng giao tiếp lấy công việc làm trung tâm cho cộng đồng hội thánh. Đặc tả: [`docs/spec/`](docs/spec/).

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `apps/api` | Backend Node.js + TypeScript (Fastify), modular monolith. `src/modules/<module>`; `can()` ở `modules/access` |
| `apps/web` | React + TypeScript, PWA (Vite) |
| `packages/shared` | Kiểu và mã lỗi dùng chung giữa API và web |
| `db/migrations` | Migration PostgreSQL chuẩn, chạy ở mọi môi trường |
| `db/supabase` | Đối tượng đặc thù Supabase (AD-29), chỉ chạy với `--supabase` |
| `docs/` | Đặc tả, hướng dẫn thiết lập, ghi chú triển khai |

## Chạy

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # điền DATABASE_URL, SUPABASE_URL
cp apps/web/.env.example apps/web/.env   # điền VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
pnpm db:migrate -- --supabase            # bỏ --supabase nếu dùng Postgres thường
pnpm dev:api
pnpm dev:web
```

Kiểm thử: `TEST_DATABASE_URL=postgres://... pnpm test` (kiểm thử DB tự bỏ qua nếu không có biến này; CI luôn chạy chúng).

Thiết lập Supabase và Google OAuth: [`docs/SETUP.md`](docs/SETUP.md).
