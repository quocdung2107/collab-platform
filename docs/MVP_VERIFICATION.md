# Kiểm chứng MVP (S13)

Trạng thái sau lát S13 (2026-11-14). Nguồn tiêu chí: `docs/spec/MVP_ACCEPTANCE_CRITERIA.md`.

## 1. Kiểm thử tự động

- API: 199 phép thử (16 tệp, Postgres thật), web: 12. Chạy: xem README.
- Phép thử gắn mã tiêu chí: `grep -ohE "F[0-9]+-T[0-9]+" apps/api/test/*.ts | sort -u`.
- **Chưa có phép thử gắn mã** (một số có thể đã được phủ gián tiếp, vd. F7-T4/T5 trong khối "F7-T3..T5" của `tasks.db.test.ts`, N1 trong nhiều tệp; cần rà và gắn mã ở lát sau):
  F2-T1, F2-T2, F2-T4, F3-T3, F5-T2, F7-T4, F7-T5, F9-T7 (phía máy khách), F9-T9, F10-T2, F10-T6, F11-T1, F11-T2, F11-T4, F11-T12, F11-T14, F12-T3, F14-T3 (bảng T1–T15 chưa có phép thử riêng từng dòng), F14-T5.
- Điều kiện "xong" số 1 của MVP (mọi `F*-T*` qua) **chưa đạt** cho tới khi danh sách trên trống.

## 2. Kịch bản đầu-cuối trên thiết bị thật (Dung chạy)

Chuẩn bị: 3 tài khoản Google (A = quản trị/phụ trách, B, C), ít nhất một iPhone đã thêm ứng dụng vào Màn hình chính. Mỗi máy vào **Cài đặt → Bật thông báo trên máy này**.

| Mã | Các bước | Kỳ vọng |
| --- | --- | --- |
| E2E-1 | A tạo buổi Chúa nhật từ mẫu, xếp B và C, công bố. B nhận, C từ chối (ghi lý do). A thay C bằng người khác (hoặc A tự nhận). A dời giờ 1 tiếng | B, C nhận đẩy "Cần bạn" sau ~30 giây; A nhận "Cần bạn: cần người thay" khi C từ chối (không thấy lý do trên màn hình khoá); sau dời giờ B phải xác nhận lại; **Lịch sử** của buổi hiện "Dời giờ" với giờ cũ → mới và các hệ quả lồng bên dưới |
| E2E-2 | Trong chat nhóm, B gửi tin; A chạm "Tạo việc" từ tin đó và giao cho C (C không thuộc nhóm). C nhận việc, đánh dấu xong | C thấy việc và "Tin nhắn gốc không khả dụng", không mở được chat nhóm; người trong nhóm nhận một đẩy chat thu gọn ("n tin mới") |
| E2E-3 | A xếp một người chưa vào tổ chức (mời trước, chưa nhận), rồi người đó nhận lời mời | Lần mở đầu tiên, mục "Cần bạn" có sẵn yêu cầu, trả lời ngay được |
| E2E-4 | A huỷ một buổi đã có người nhận và có Task đang làm | Người được xếp nhận "Nên biết" huỷ buổi; Task bị huỷ theo; Lịch sử ghi cả hai |
| Giờ yên lặng | Đặt giờ yên lặng bao trùm giờ hiện tại (Cài đặt), nhờ người khác giao việc | Không đẩy; hết giờ yên lặng nhận **một** thông báo tóm tắt |

## 3. Việc vận hành trước khi thử

1. Render → Environment: `SUPABASE_SERVICE_KEY` (tệp), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (đẩy). Xem `docs/SETUP.md` §5.
2. Merge các PR theo thứ tự (mỗi PR dựa trên PR trước).
3. Sau khi thử xong OD-17 không cần nữa: xoá hàm Edge `push-spike`, `od19-spike` và schema `spike` trên Supabase (thao tác xoá, cần Dung đồng ý).
