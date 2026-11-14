# Kết quả OD-19 · 2026-11-14

Dự án Supabase `jgdbeutyiwyrgjirakvn` (ap-south-1), supabase-js 2.119.0 chạy trong Edge Function.
Ba người dùng thử: A và B trong nhóm, C cùng tổ chức nhưng ngoài nhóm. Kênh riêng `group:{id}` và `user:{B}`.

## Lần chạy 2 (Realtime đã khởi tạo)

| Bước | Thời điểm (ms) | A | B | C |
| --- | --- | --- | --- | --- |
| Join `group:{id}` | | SUBSCRIBED | SUBSCRIBED | CHANNEL_ERROR "Unauthorized" |
| m1 trước khi gỡ | 74925 | nhận | nhận (sau 10 ms) | — |
| **Gỡ B khỏi nhóm** (xoá `group_members`) | 77437 | | | |
| m2 ngay sau khi gỡ | 77437 | nhận | **vẫn nhận** | — |
| `access_changed` tới `user:{B}` | 77442 | | nhận (sau 7 ms) | |
| m3 sau 7,5 giây | 84948 | nhận | **vẫn nhận** | — |
| B `refreshSession()` + `realtime.setAuth()` | 87491 | | Realtime gửi lỗi quyền, kênh **CLOSED** sau 7 ms | |
| m4 sau khi B làm mới token | 89993 | nhận | không nhận | — |
| B join lại kênh nhóm | 94518 | | CHANNEL_ERROR "Unauthorized" | |
| m5 | 94518 | nhận | không nhận | — |

## Kết luận

1. **Phân quyền khi join hoạt động đúng:** người ngoài nhóm (C) và người đã bị gỡ (B join lại) đều bị từ chối.
2. **Quyền được lưu đệm trong suốt kết nối:** sau khi bị gỡ, B tiếp tục nhận sự kiện của nhóm (m2, m3) cho tới khi gửi JWT mới.
   Khớp với tài liệu Supabase ("Client access policies are cached for the duration of the connection").
3. **Gửi JWT mới làm Realtime đánh giá lại và đóng kênh ngay** (7 ms). Đây là cơ chế thu hồi dùng được.
4. Sự kiện `access_changed` tới kênh `user:{id}` đến ngay (7 ms), nên máy khách hợp tác có khoảng hở khoảng vài chục ms.
5. Máy khách không hợp tác (bị sửa để bỏ qua `access_changed`) nhận tiếp tới khi JWT hết hạn. Vì sự kiện chỉ mang định danh (AD-10),
   thứ lộ ra trong khoảng hở là định danh và thời điểm hoạt động, không phải nội dung.

## Lần chạy 1 (dự án mới, Realtime chưa khởi tạo)

Join đầu tiên nhận lỗi `MissingPartition` rồi tự khỏi; **không người nào nhận được sự kiện nào**, dù các dòng đã có trong
`realtime.messages`. Lần chạy 2 ngay sau đó bình thường. Hệ quả thiết kế: Realtime là tín hiệu có thể mất, máy khách phải tải lại
qua API khi kết nối lại; không dùng Realtime làm nguồn dữ liệu.

## Việc phải làm theo kết quả (đưa vào Bước 3)

- Lệnh làm mất quyền đọc phát `access_changed` tới `user:{id}` (cùng giao dịch).
- Máy khách: khi nhận `access_changed` thì `refreshSession()` → `realtime.setAuth()` → xoá cache liên quan.
- Đặt JWT expiry ngắn (đề xuất 600 giây) trong Supabase Auth.
- Tắt "Allow public access" trong Realtime Settings để mọi kênh bắt buộc là kênh riêng.

## Chưa kiểm chứng

- Hành vi khi mạng di động chập chờn và trên iOS Safari/PWA (Edge Function chạy Deno, không phải trình duyệt).
- `realtime.send` khi giao dịch bị rollback (dự kiến không gửi vì dòng không được commit; chưa đo).
