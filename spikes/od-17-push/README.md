# Thử nghiệm OD-17: thông báo đẩy trên iPhone (PWA)

Câu hỏi: Web Push tới PWA đã thêm vào Màn hình chính trên iPhone có đến tin cậy không, kể cả khi máy khoá / ứng dụng đóng,
và trải nghiệm bật thông báo có vướng ở đâu.

## Thành phần

- Web: `apps/web/src/sw.ts` (service worker nhận push, báo nhận về máy chủ), `apps/web/src/lib/push.ts`,
  trang thử `#od17` (`apps/web/src/pages/PushTest.tsx`).
- Máy chủ: Supabase Edge Function `push-spike` (`index.ts`), bảng tạm ở `schema.sql` (schema `spike`).
  Khoá VAPID của bản thử lưu trong `spike.config`; bản thật phải dùng secret của Backend.
- Triển khai web: `.github/workflows/pages.yml` → `https://quocdung2107.github.io/collab-platform/`.

Kiểm tra từ máy chủ đã làm: hàm ký VAPID và gọi được dịch vụ push (FCM trả 410 cho token giả, đúng như mong đợi).

## Cách thử trên iPhone

1. Mở `https://quocdung2107.github.io/collab-platform/#od17` bằng Safari.
2. Chia sẻ → Thêm vào MH chính. Mở ứng dụng từ biểu tượng mới, vào lại `#od17` nếu cần.
3. Bấm "1. Bật thông báo" → Cho phép.
4. Bấm "2. Gửi thử" (ứng dụng đang mở), rồi "3. Gửi sau 30 giây" và khoá máy ngay; lặp lại một lần với ứng dụng bị vuốt đóng.
5. Kết quả ghi ở `spike.push_log` (`push_status`, `received_at`, `app_state`).

## Kết quả

Chưa có, chờ thử trên thiết bị thật.
