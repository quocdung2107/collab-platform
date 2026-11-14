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
| IN-09 | Mọi lệnh ghi chạy qua `runCommand` (`apps/api/src/http/command.ts`): một giao dịch gồm thay đổi + ActivityEvent + tín hiệu realtime + bản ghi Idempotency-Key | AD-08/AD-31: tín hiệu chỉ phát khi giao dịch commit; lệnh lỗi không giữ khoá nên gửi lại được | Ghi khoá idempotency ở giao dịch riêng: có thể giữ khoá cho lệnh đã rollback |
| IN-10 | Idempotency-Key lưu ở `app.idempotency_keys` theo (user, key), kèm hash thân yêu cầu; khoá > 24 giờ được dùng lại | EVENT_API_CONTRACTS §4. Cùng khoá khác nội dung → `validation_failed` | Redis/bộ nhớ: mất khi khởi động lại, thêm hạ tầng |
| IN-11 | Token mời 256 bit base64url, chỉ lưu SHA-256; nhận lời mời khoá dòng `invites` (`FOR UPDATE`) | F1-T1/F1-T2: nhận đồng thời lời mời `max_uses = 1` → đúng một người thành công | Đếm lượt bằng `UPDATE … WHERE used_count < max_uses` không khoá: khó trả lý do lỗi chính xác |
| IN-12 | Web định tuyến bằng hash (`#org=`, `#group=`, `#invite=`) | Chạy trên GitHub Pages không có rewrite; token mời được giữ qua vòng OAuth bằng localStorage | React Router với history API: cần cấu hình 404 fallback |

## Chưa làm, có chủ đích

- Tạo Conversation cho nhóm khi tạo nhóm, và chuyển hội thoại sang chỉ-đọc khi lưu trữ nhóm: làm cùng F9 (Messaging). Đánh dấu `TODO(F9)` trong `groups.ts`.
- Hệ quả của gỡ thành viên lên Assignment/Task/Event/Subscription/thiết bị đẩy (F1-T4/T5): làm cùng F4–F8, đánh dấu `TODO(F4–F8)` trong `members.ts`.
- Nhắc org admin khi nhóm mất trưởng nhóm cuối cùng: làm cùng F11.
- ESLint/Prettier: thêm khi có nhiều người/agent cùng sửa mã.
