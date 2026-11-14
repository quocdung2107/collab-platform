# Ghi chú triển khai

Các quyết định ở mức triển khai, không thay đổi AD nào trong `docs/spec/ARCHITECTURE_DECISIONS.md`. Mỗi mục: quyết định · lý do · phương án đã loại.

| Mã | Quyết định | Lý do | Đã loại |
| --- | --- | --- | --- |
| IN-01 | Monorepo pnpm: `apps/api`, `apps/web`, `packages/shared` | Một kho, chia sẻ kiểu API/mã lỗi giữa hai đầu | Hai kho riêng: lệch kiểu dễ xảy ra |
| IN-02 | API dùng Fastify 5 + `pg` với SQL viết tay trong từng module | SQL minh bạch, khớp DATA_MODEL; giao dịch và outbox (AD-08) dễ kiểm soát | ORM (Prisma): khó dùng chỉ mục một phần, CHECK, khoá dòng. Query builder (Kysely): có thể thêm sau nếu SQL lặp nhiều |
| IN-03 | Bảng nghiệp vụ nằm ở schema `app`, không ở `public` | Data API của Supabase chỉ phơi `public`; máy khách không thể đọc/ghi thẳng bảng nghiệp vụ (AD-28) ngay cả khi RLS cấu hình sai | Để ở `public` và dựa hoàn toàn vào RLS |
| IN-04 | Trình chạy migration tự viết (`apps/api/src/db/migrate.ts`), checksum mỗi tệp | AD-29: SQL có phiên bản, chạy có kiểm soát, không phụ thuộc Supabase CLI; phát hiện tệp đã chạy bị sửa | Supabase CLI migrations: buộc vào công cụ nhà cung cấp |
| IN-05 | `can()` là hàm thuần trên `ActorContext` nạp sẵn; trả `not_found` hoặc `forbidden` | Kiểm thử theo ma trận không cần DB; thực thi AD-12 ở một chỗ | `can()` tự truy vấn DB: chậm và khó kiểm thử |
| IN-06 | Người dùng nội bộ được tạo ở yêu cầu API đầu tiên mang JWT hợp lệ (`provisionUser`) | Không cần trigger trên `auth.users` (AD-26: không FK tới schema nhà cung cấp) | Trigger Postgres trên `auth.users` |
| IN-07 | `app.uuid_v7()` viết bằng PL/pgSQL | PostgreSQL < 18 chưa có `uuidv7()` | Sinh ở ứng dụng: mất mặc định ở cột |
| IN-08 | Đăng nhập Google dùng luồng PKCE của supabase-js | Không để token trong URL fragment | Luồng implicit |

## Chưa làm, có chủ đích

- Bảng và lệnh của F1/F2 (tạo tổ chức, lời mời, nhóm): Bước 3.
- `Idempotency-Key` và bảng lưu khoá: cùng lệnh ghi đầu tiên ở Bước 3.
- Chính sách RLS trên `realtime.messages`: sau thử nghiệm OD-19 (Bước 2).
- ESLint/Prettier: thêm khi có nhiều người/agent cùng sửa mã.
