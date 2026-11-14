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
| S6 | Lõi thông báo: hộp thông báo, khử trùng, gộp, Subscription, dòng hệ thống (F11a) | #10 |
| S7 | Trả lời phân công, trả lời hộ, gỡ, thay người; gỡ thành viên huỷ vị trí tương lai (F5, F6, F1-T4) | #11 |
| S8 | My Workspace: Cần xử lý, Cần phản hồi, Sắp tới, Có gì mới (F12) | #12 |
| S9 | Dời lịch (xác nhận lại theo ngưỡng/đổi ngày), đổi địa điểm, huỷ buổi (F7) | #13 |
| S10 | Task: tạo/giao/nhận/tiến độ/cờ/người cùng làm, thread Task, Task mẫu, dời hạn theo buổi, gỡ thành viên (F8, F7-T3..T5, F1-T5) | #14 |
| S11a | Liên kết: Task từ tin nhắn, thẻ đối tượng, khối Liên quan, Link giữa hai đối tượng (F10) | #15 |
| S11b | Tệp đính kèm trong tin, buổi, việc qua Storage; URL ký ngắn hạn (F9b, F14-T4) | PR S11b |
| S12 | Đẩy thật (F11b): thiết bị gắn tài khoản, Web Push VAPID ở Backend, Preference, giờ yên lặng + tóm tắt, debounce, thử lại, đẩy chat thu gọn theo hội thoại; trang Cài đặt (F11-T3, T6..T11; F14-T6; IN-43..47) | PR S12 |

## Thứ tự còn lại

| Lát | Nội dung | Tiêu chí | Phụ thuộc | Ghi chú |
| --- | --- | --- | --- | --- |
| S13 | **Lịch sử + rà soát (F13, F14)**: trang Lịch sử, quét T1–T15, 4 kịch bản E2E trên thiết bị thật | F13-T1..T5; F14-T1,T3,T5; E2E-1..4 | tất cả | Dọn dữ liệu/hàm thử nghiệm |

## Vì sao hội thoại đi trước Event
- F3 yêu cầu "Conversation của Event được tạo" khi publish; F10 cần cả hai. Làm hội thoại trước thì Event dùng lại được, không phải để `TODO`.
- Nhóm đã có (S3) nên hội thoại nhóm dùng thử được ngay với người thật.
- Phương án đã cân nhắc: Event trước (giá trị "lịch phục vụ" sớm hơn một lát) — đổi lại phải quay lại sửa publish ở S4. Có thể đảo nếu chủ sản phẩm ưu tiên lịch phục vụ.

## Quy ước mỗi lát
Migration mới (không sửa migration cũ) · `can()` mở rộng theo PERMISSION_MODEL · mọi lệnh ghi qua `runCommand` · kiểm thử mang mã tiêu chí trong tên · cập nhật `IMPLEMENTATION_NOTES.md` và đặc tả khi lệch.
