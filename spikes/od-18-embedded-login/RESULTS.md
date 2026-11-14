# OD-18 — Đăng nhập Google khi mở liên kết từ Zalo (2026-11-14)

Mã: `apps/web/src/lib/embeddedBrowser.ts` (nhận diện qua User-Agent), `apps/web/src/pages/OpenInBrowser.tsx`.

## Đã kiểm chứng (chủ sản phẩm thử trên thiết bị thật)
- Mở liên kết ngay trong Zalo → trang nhận ra trình duyệt nhúng và hiện "Mở bằng trình duyệt để đăng nhập" thay vì nút Google.
- Chuyển sang trình duyệt hệ thống → đăng nhập Google thành công, phiên được giữ (luồng PKCE).

## Chưa kiểm chứng
- Messenger/Facebook, Instagram; Android và iPhone chưa được ghi riêng từng nền tảng.
- Tỷ lệ người dùng thật làm đúng bước "mở bằng trình duyệt" (đo ở pilot).
- Liên kết mời giữ được token sau khi chuyển trình duyệt: token nằm trong URL (`#invite=`) nên đi theo khi sao chép/mở lại; cần thử khi mời người thật.

## Kết luận
Phương án (a) của OD-18 hoạt động với Zalo. Giữ (a) cho MVP; chỉ nâng lên (b) đăng nhập email/OTP nếu pilot cho thấy nhiều người bỏ cuộc ở bước này.
