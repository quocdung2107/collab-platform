# Lịch nhiều cấp: năm, quý, tháng, tuần

Chốt: 2026-11-15 (AD-32). Bản nghiên cứu đầy đủ, ba phương án và mockup: trang "Lịch nhiều cấp" của dự án (ảnh trong thư mục này).

## Vấn đề
Người lập lịch thường đi từ chung tới riêng (năm → quý → tháng → tuần) nhưng cũng cần lặp ngược lên (tuần → tháng/quý/năm, tháng → năm). Không có bố cục phù hợp thì lịch rối mắt.

## Quyết định
| Câu hỏi | Chốt |
| --- | --- |
| Mô hình dữ liệu | C: Giai đoạn · Nhịp + Biến thể · Buổi (AD-32) |
| Bố cục | L1 (bốn mức Năm/Quý/Tháng/Tuần) là khung chính, bên trong có L2 (cây tổng quan) và L3 (bảng Nhịp & Giai đoạn) |
| Buổi dự kiến thành bản nháp | Chỉ khi người lập lịch bấm "Tạo bản nháp" cho một khoảng |
| Quý | Chỉ là khung nhìn; ghi chú theo quý = một Giai đoạn trùng quý |

## Bố cục
- Thành viên: tab Lịch giữ nguyên (Tất cả / Của tôi / Theo nhóm). Nút "Lập lịch" chỉ hiện cho quản trị tổ chức và trưởng nhóm.
- Lập lịch, máy tính (≥ 1024px): ba cột. Trái: cây Năm › Quý › Tháng › Tuần có số chỗ cần chú ý (L2). Giữa: mức đang xem (L1). Phải: Nhịp & Giai đoạn, ẩn/hiện từng nhịp (L3).
- Lập lịch, điện thoại: chỉ cột giữa; L2 và L3 mở thành bảng trượt.
- Mỗi mức trả lời một câu hỏi: Năm = giai đoạn và tháng nào cần chú ý; Quý = ma trận tuần × nhịp (thiếu người, nháp, tuần trống); Tháng = lưới tháng + danh sách theo tuần; Tuần = từng buổi với số vị trí đã lấp.

## Thứ tự ưu tiên khi nhiều cấp trùng ngày
sửa riêng › ngày cụ thể › trong giai đoạn › thứ n của tháng › nhịp tuần. Buổi đặc biệt trùng buổi của Nhịp: đánh dấu "cần quyết" (thay thế / giữ cả hai / bỏ buổi thường).

## Lộ trình
| Bước | Nội dung | Lược đồ |
| --- | --- | --- |
| P1 | Chế độ Lập lịch: bốn mức + cây + bảng nhịp trên dữ liệu hiện có. "Nhịp" tạm suy ra từ mẫu (hoặc tên) + thứ + giờ (IN-53) | Không đổi |
| P2 | Giai đoạn và ngày đặc biệt | `plan_periods` |
| P3 | Nhịp, buổi dự kiến, "Tạo bản nháp" theo khoảng, "Lặp tuần này" | `event_series`, cột mới trên `events` |
| P4 | Biến thể, thứ tự ưu tiên, "cần quyết", "Lặp tháng này" | `series_variants` |
| P5 | Sửa nhịp theo phạm vi; buổi đã gửi qua Dời lịch | — |
