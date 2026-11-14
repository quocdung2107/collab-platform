# OD-17 — Kết quả thử nghiệm Web Push trên iPhone (2026-11-14)

## Đã kiểm chứng (dữ liệu trong `spike.push_subscriptions`, `spike.push_log`)

| Hạng mục | Kết quả |
| --- | --- |
| Thiết bị | iPhone, UA `iPhone OS 18_7 … Version/27.0.1 Mobile Safari` |
| Chế độ | Mở từ Màn hình chính (`standalone = true`) |
| Đăng ký | Thành công; endpoint `web.push.apple.com` (APNs qua Web Push, khoá VAPID) |
| Gửi ngay (3 s) | Máy chủ push trả 201; service worker báo nhận sau ~0,4 s; trạng thái ứng dụng lúc nhận: `closed` |
| Gửi trễ 30 s (khoá máy/thoát ứng dụng) | 201; báo nhận sau ~0,4 s kể từ lúc gửi; trạng thái `closed` |

Thất bại ở lần thử đầu: nút "Bật thông báo" không phản hồi và không có đăng ký nào tới máy chủ. Sau khi thêm chẩn đoán từng bước (PR #5) và cài lại ứng dụng vào Màn hình chính, đăng ký thành công. Nguyên nhân gốc của lần đầu không ghi nhận được (giả thuyết: trang mở trong Safari chứ không từ biểu tượng, hoặc bản cài cũ).

## Giới hạn của phép thử
- Một thiết bị, một lần thử, mạng tốt. Chưa đo: máy ở chế độ Tiết kiệm pin/Tập trung, để qua đêm, sau khi khởi động lại máy, nhiều ngày không mở ứng dụng.
- "Báo nhận" là lúc service worker chạy `push` handler; chưa xác nhận bằng mắt rằng banner hiển thị trên màn hình khoá (chủ sản phẩm thấy thông báo nhưng chưa ghi lại chi tiết).
- Chưa thử Android.

## Kết luận
Rủi ro kỹ thuật chính của OD-17 (Web Push trên iPhone có chạy không) đã được gỡ: chạy được khi ứng dụng được thêm vào Màn hình chính, kể cả khi ứng dụng đóng. Rủi ro còn lại là hành vi người dùng (tỷ lệ cài vào Màn hình chính), giữ phương án (a)+(b) của OD-17: hướng dẫn cài trong ứng dụng + kênh email cho `action_required`, đo tỷ lệ cài ở pilot.
