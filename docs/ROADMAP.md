# Lộ trình MVP (bước 4)

Cập nhật: 2026-11-14. Nguồn tiêu chí: `docs/spec/MVP_ACCEPTANCE_CRITERIA.md`. Mỗi lát cắt = một PR, có API + kiểm thử tiêu chí + giao diện tối thiểu, cập nhật đặc tả khi lệch.

## Đã xong
| Lát | Nội dung | PR |
| --- | --- | --- |
| Nền | Monorepo, migration, `can()`, đăng nhập Google, CI, Pages | #1, #3 |
| Thử nghiệm | OD-19 realtime (AD-31), OD-17 push iPhone, OD-18 Zalo | #2, #5, #7 |
| S3 | F1 tổ chức/lời mời/thành viên, F2 nhóm, F14 truy cập chéo (một phần) | #4 |
| Hạ tầng | API trên Render, web Pages nối API | #6 |
| S4 | Hội thoại nhóm (F9a) | #8 |
| S5 | Event, Position, xếp người, mẫu, sao chép, thread Event (F3, F4) | #9 |
| S6 | Lõi thông báo: hộp thông báo, khử trùng, gộp, Subscription, dòng hệ thống (F11a) | PR S6 |

## Thứ tự còn lại

| Lát | Nội dung | Tiêu chí | Phụ thuộc | Ghi chú |
| --- | --- | --- | --- | --- |
| S7 | **Trả lời, gỡ, thay người (F5, F6)** | F5-T1..T7; F6-T1..T5 | S6 | Gỡ `TODO(F4–F8)` phần Assignment khi gỡ thành viên (F1-T4) |
| S8 | **My Workspace (F12)** | F12-T1..T5; E2E-3 | S7 | Màn hình chính của người dùng |
| S9 | **Dời lịch, đổi địa điểm, huỷ (F7)** | F7-T1..T10 | S7, S8 | Bảng §8.5 của NOTIFICATION_ENGINE |
| S10 | **Task (F8)** | F8-T1..T8; F7-T3..T5 | S9 | Gỡ `TODO(F4–F8)` phần Task (F1-T5) |
| S11 | **Liên kết + tệp (F10, F9b)**: Task từ tin nhắn, thẻ đối tượng, khối Liên quan; ảnh/tệp qua Storage | F10-T1..T7; F14-T4 | S4, S10 | |
| S12 | **Đẩy thật (F11b)**: thiết bị, Web Push (từ OD-17), Preference, giờ yên lặng, thử lại | F11-T6..T9, T11; F14-T6 | S6 | Bỏ hàm thử `push-spike` |
| S13 | **Lịch sử + rà soát (F13, F14)**: trang Lịch sử, quét T1–T15, 4 kịch bản E2E trên thiết bị thật | F13-T1..T5; F14-T1,T3,T5; E2E-1..4 | tất cả | Dọn dữ liệu/hàm thử nghiệm |

## Vì sao hội thoại đi trước Event
- F3 yêu cầu "Conversation của Event được tạo" khi publish; F10 cần cả hai. Làm hội thoại trước thì Event dùng lại được, không phải để `TODO`.
- Nhóm đã có (S3) nên hội thoại nhóm dùng thử được ngay với người thật.
- Phương án đã cân nhắc: Event trước (giá trị "lịch phục vụ" sớm hơn một lát) — đổi lại phải quay lại sửa publish ở S4. Có thể đảo nếu chủ sản phẩm ưu tiên lịch phục vụ.

## Quy ước mỗi lát
Migration mới (không sửa migration cũ) · `can()` mở rộng theo PERMISSION_MODEL · mọi lệnh ghi qua `runCommand` · kiểm thử mang mã tiêu chí trong tên · cập nhật `IMPLEMENTATION_NOTES.md` và đặc tả khi lệch.
