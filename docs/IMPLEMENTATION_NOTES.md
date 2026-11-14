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
| IN-13 | API thử nghiệm chạy trên Render (gói miễn phí, Singapore) qua `render.yaml`; web Pages lấy URL API từ biến repo `API_URL` | Dung chọn 2026-11-14; Blueprint trong repo nên cấu hình có phiên bản | Fly.io/Railway: cần thẻ thanh toán; Supabase Edge Functions: không chạy Fastify/pg như Node |
| IN-14 | Hội thoại: cấp `seq` bằng `UPDATE conversations SET last_seq = last_seq + 1` sau khi khoá dòng hội thoại; kiểm `client_msg_id` trong cùng khoá | F9-T1/T2: seq liền mạch, gửi lặp đồng thời không tạo tin thứ hai, không thủng seq | Sequence Postgres riêng cho mỗi hội thoại: nhiều đối tượng DB; `max(seq)+1`: đua khi đồng thời |
| IN-15 | Kênh realtime `conversation:{id}` (thêm vào `rt.can_read_topic`, `db/supabase/0003_realtime_conversation.sql`); tín hiệu `conversation.message` / `conversation.message_changed` mang `conversation_id`, `seq`, không nội dung | EVENT_API_CONTRACTS §3; hội thoại Event/Task sau này có người đọc khác thành viên nhóm nên không dùng chung `group:{id}` | Dùng `group:{id}`: sai người nhận khi có hội thoại Event |
| IN-16 | Tin chưa gửi được giữ ở `localStorage` theo hội thoại, gửi lại cùng `clientMsgId` khi có mạng | F9-T7 không cần service worker đồng bộ nền | Background Sync API: Safari chưa hỗ trợ |

## Chưa làm, có chủ đích

- Tin `system` (chiếu ActivityEvent vào hội thoại, F9-T9) và thông báo mention (F9-T3/T4/T6): làm cùng lõi thông báo S6.
- Tệp đính kèm trong tin nhắn: S11.
- Hệ quả của gỡ thành viên lên Assignment/Task/Event/Subscription/thiết bị đẩy (F1-T4/T5): làm cùng F4–F8, đánh dấu `TODO(F4–F8)` trong `members.ts`.
- Nhắc org admin khi nhóm mất trưởng nhóm cuối cùng: làm cùng F11.
- ESLint/Prettier: thêm khi có nhiều người/agent cùng sửa mã.
