# KOINONIA_INTEGRATION

Phiên bản 0.1 · 2026-11-13 · Phạm vi: `[EXT]` (Phase 4). MVP không phụ thuộc tài liệu này.

Phụ thuộc: `PRODUCT_MODEL.md`, `DATA_MODEL.md` (bảng `[S]` `event_items`), `EVENT_API_CONTRACTS.md`.

## 0. Giới hạn của tài liệu

- Tài liệu định nghĩa contract **tại biên** giữa hai ứng dụng.
- Phần mô tả phía Koinonia dựa trên hiểu biết ở mức khái niệm (project `.kproj`, Master Playlist, nhóm slide bài hát, lớp dữ liệu đám mây đang dự kiến). **Chưa đối chiếu với mã nguồn Koinonia.** Mọi ánh xạ vào cấu trúc nội bộ Koinonia ở §6 là đề xuất và phải được kiểm tra bằng cách đọc code trước khi triển khai phía Koinonia (OD-14).
- "Nền tảng" dưới đây là Collaboration Platform.

## 1. Nguyên tắc

1. **Phụ thuộc một chiều.** Koinonia biết Nền tảng; Nền tảng không biết Koinonia. Nền tảng không gọi, không lưu địa chỉ, không có nhánh logic nào dành riêng cho Koinonia.
2. **Contract trung tính.** API mà Koinonia dùng là "xuất kế hoạch của một Event" cho mọi client bên ngoài, không phải API riêng cho trình chiếu.
3. **Mỗi dữ liệu một chủ.** Không có dữ liệu nào được sửa ở cả hai phía.
4. **Mỗi ứng dụng dùng được một mình.** Koinonia chạy đầy đủ khi không kết nối Nền tảng; Nền tảng chạy đầy đủ khi không có Koinonia.
5. **Kéo, không đẩy.** Koinonia chủ động lấy; không có webhook từ Nền tảng sang Koinonia.

## 2. Quyền sở hữu dữ liệu

| Dữ liệu | Chủ sở hữu | Phía kia |
| --- | --- | --- |
| Event (thời gian, địa điểm, trạng thái) | Nền tảng | Koinonia đọc |
| Dòng chương trình: thứ tự, loại mục, tiêu đề, thời lượng, ghi chú | Nền tảng | Koinonia đọc |
| Position, Assignment, Task, hội thoại, thông báo | Nền tảng | Koinonia **không** truy cập |
| Slide, bố cục, hoạt cảnh, lớp phủ | Koinonia | Nền tảng không biết |
| Thư viện bài hát và nhóm slide | Koinonia | Nền tảng chỉ giữ tham chiếu mờ (`external_refs`) |
| Master Playlist, định tuyến output, trạng thái trình chiếu | Koinonia | Nền tảng không biết |
| Tệp project | Koinonia | Nền tảng không biết |
| Ánh xạ "mục chương trình ↔ nội dung Koinonia" | Koinonia (lưu trong project) | Nền tảng có thể giữ bản sao tham chiếu, xem §4 |
| Tài khoản người dùng | Mỗi bên tự quản | OD-09 |

## 3. Dữ liệu được đồng bộ và chiều đồng bộ

| Luồng | Chiều | Nội dung | Bắt buộc? |
| --- | --- | --- | --- |
| F1. Kế hoạch buổi | Nền tảng → Koinonia (Koinonia kéo) | Một bản `Plan` chỉ-đọc của một Event | Lõi của tích hợp |
| F2. Tham chiếu ngược | Koinonia → Nền tảng (Koinonia ghi qua API công khai) | `external_refs` trên từng mục chương trình | Tuỳ chọn; OD-10 |

Không có luồng nào khác. Không đồng bộ thành viên, phân công, tin nhắn hay nội dung slide.

## 4. Contract

### 4.1 Tài nguyên `Plan`

Lấy bằng: `GET /v1/events/{event_id}/plan` · phạm vi quyền `plan:read`.

| Trường | Kiểu | Nghĩa |
| --- | --- | --- |
| `schema_version` | chuỗi `major.minor` | Phiên bản cấu trúc của tài nguyên |
| `event.id`, `event.title`, `event.starts_at`, `event.ends_at`, `event.location`, `event.status` | | Thông tin buổi |
| `plan_version` | số nguyên | Tăng 1 mỗi lần dòng chương trình thay đổi (thêm, bớt, đổi thứ tự, sửa mục) |
| `updated_at` | thời điểm | |
| `items[]` | danh sách có thứ tự | |
| `items[].id` | uuid | **Ổn định** qua các lần sửa và đổi thứ tự |
| `items[].position` | số nguyên | Thứ tự hiển thị |
| `items[].kind` | chuỗi | Loại mục do tổ chức cấu hình (ví dụ `song`, `reading`, `talk`, `generic`). Client phải coi giá trị lạ là `generic` |
| `items[].title` | chuỗi | |
| `items[].duration_min` | số? | |
| `items[].notes` | chuỗi? | Ghi chú cho người vận hành |
| `items[].external_refs` | đối tượng `{namespace: {…}}` | Dữ liệu mờ do client ngoài ghi; Nền tảng không diễn giải |

Phản hồi kèm thẻ phiên bản (`ETag` = `plan_version`). Yêu cầu có điều kiện trả "không đổi" khi `plan_version` trùng.

Liệt kê Event để chọn: `GET /v1/orgs/{org_id}/events?from=&to=` · phạm vi `plan:read` · chỉ trả Event mà người cấp quyền xem được, chỉ gồm `id`, `title`, `starts_at`, `status`, `plan_version`.

### 4.2 Ghi tham chiếu ngược (F2)

`PUT /v1/events/{event_id}/plan/items/{item_id}/external-refs/{namespace}` · phạm vi `plan.refs:write`.

- Thân: đối tượng JSON nhỏ, giới hạn kích thước; Nền tảng lưu nguyên, không kiểm tra nghĩa.
- `namespace` do client đăng ký khi được cấp quyền (ví dụ `koinonia`). Client chỉ ghi được namespace của mình.
- **Không** làm tăng `plan_version` và **không** phát `event.plan_changed`: đây là chú thích, không phải thay đổi kế hoạch.
- Mục đích: lần sau mở cùng Event trên máy khác, Koinonia tìm lại được nội dung đã ghép.

### 4.3 Xác thực và uỷ quyền

| Khía cạnh | Quy tắc |
| --- | --- |
| Danh tính client | Koinonia là một `integration_clients` đã đăng ký |
| Uỷ quyền | Người dùng Nền tảng cấp quyền cho bản cài Koinonia của mình qua luồng uỷ quyền dành cho ứng dụng máy bàn; kết quả là một `access_grants` gắn với người dùng + tổ chức + phạm vi |
| Quyền hiệu lực | Giao của phạm vi được cấp và quyền của người cấp. Người cấp mất quyền xem Event → Koinonia cũng mất |
| Thu hồi | Người dùng hoặc org admin thu hồi bất kỳ lúc nào |
| Phạm vi | Chỉ `plan:read` và `plan.refs:write`. Không có phạm vi nào chạm tới Assignment, Task, Message |

Phương thức đăng nhập cụ thể và việc có dùng chung nhà cung cấp danh tính hay không: OD-08, OD-09.

### 4.4 Lỗi

| Tình huống | Phản hồi | Koinonia nên |
| --- | --- | --- |
| Hết hạn/thu hồi quyền | `unauthenticated` | Yêu cầu kết nối lại; tiếp tục dùng bản đã nhập |
| Event không tồn tại hoặc không còn quyền | `not_found` | Giữ bản đã nhập, đánh dấu "mất liên kết" |
| Event bị huỷ | `Plan` với `event.status = cancelled` | Cảnh báo, không tự xoá gì |
| Mất mạng, quá thời gian | — | Dùng bản đã nhập; thử lại theo yêu cầu người dùng |
| `schema_version` có `major` lạ | — | Từ chối nhập, báo cần cập nhật Koinonia |
| Quá tần suất | `rate_limited` | Giãn cách |

## 5. Phiên bản và tương thích

| Lớp | Cơ chế | Quy tắc thay đổi |
| --- | --- | --- |
| Đường dẫn API | `/v1` | Thay đổi phá vỡ → `/v2`; `/v1` được duy trì trong một khoảng thời gian công bố trước |
| Cấu trúc `Plan` | `schema_version` | Tăng `minor`: chỉ thêm trường tuỳ chọn hoặc giá trị `kind` mới. Tăng `major`: đổi nghĩa/bỏ trường |
| Nội dung kế hoạch | `plan_version` | Đơn điệu tăng theo từng Event |
| Client | Phải bỏ qua trường lạ, coi `kind` lạ là `generic` | |

## 6. Xử lý phía Koinonia (đề xuất, cần đối chiếu code)

### 6.1 Nhập

1. Người dùng chọn một Event từ danh sách → Koinonia lấy `Plan`.
2. Koinonia lưu vào project: `event_id`, `plan_version` đã nhập, và với mỗi mục: `item_id` + nội dung Koinonia được ghép (nếu có).
3. Ghép nội dung: theo `external_refs.koinonia` nếu có; nếu không, gợi ý theo tiêu đề để người dùng xác nhận. Không tự ghép âm thầm.
4. Mục không ghép được vẫn xuất hiện như một chỗ trống có tiêu đề.

### 6.2 Phát hiện thay đổi và xung đột

Vì mỗi dữ liệu có một chủ, không có xung đột ghi-ghi. Chỉ có **lệch phiên bản**: kế hoạch trên Nền tảng đã đổi sau khi nhập.

| Tình huống | Hành vi |
| --- | --- |
| `plan_version` trên Nền tảng > bản đã nhập, **không** đang trình chiếu | Hiện khác biệt theo `item_id` (thêm / bớt / đổi thứ tự / đổi tiêu đề); người dùng bấm Đồng bộ để áp |
| Như trên, **đang** trình chiếu | Chỉ cảnh báo có khác biệt. Không tự áp. Áp khi người dùng chủ động bấm Đồng bộ, nếu không thì có hiệu lực từ lần mở sau |
| Người dùng đã sắp xếp lại trong Koinonia khác với kế hoạch | Sắp xếp cục bộ là của Koinonia; khi đồng bộ, hiện rõ mục nào sẽ bị đổi chỗ và cho chọn giữ thứ tự cục bộ |
| Mục bị xoá khỏi kế hoạch nhưng đã có slide ghép | Không xoá slide; đưa mục ra khỏi danh sách phát và giữ trong project |

Hành vi "phát hiện và cảnh báo, người dùng chủ động đồng bộ, không tự áp khi đang live" nhất quán với nguyên tắc định tuyến đã chốt của Koinonia.

### 6.3 Ngoại tuyến

Sau khi nhập, Koinonia không cần Nền tảng để trình chiếu. Kiểm tra phiên bản chỉ chạy khi có mạng và theo yêu cầu hoặc lúc mở project.

## 7. Kiểm tra không có phụ thuộc vòng

| Kiểm tra | Kết quả |
| --- | --- |
| Nền tảng có gọi Koinonia? | Không. Không có webhook, không có địa chỉ Koinonia trong cấu hình |
| Nền tảng có cần Koinonia để hoàn thành lệnh nào? | Không |
| Schema Nền tảng có khái niệm của Koinonia? | Không. `external_refs` là dữ liệu mờ theo namespace; `kind` là chuỗi cấu hình |
| Koinonia có cần Nền tảng để trình chiếu? | Không, sau khi nhập |
| Hai bên có cùng sửa một dữ liệu? | Không |
| Thay đổi phía Koinonia có buộc Nền tảng phát hành lại? | Không, chừng nào còn trong `schema_version` hiện hành |

Điểm duy nhất tạo ràng buộc ngược là nhu cầu "chọn bài hát từ thư viện Koinonia ngay trong Nền tảng". Thiết kế này **không** hỗ trợ điều đó; xem OD-10.

## 8. Điều kiện tiên quyết trước khi triển khai

- `event_items` và `events.plan_version` đã có trên Nền tảng (`[S]`).
- `integration_clients`, `access_grants` và luồng uỷ quyền đã có (`[EXT]`).
- Đã đọc code Koinonia để xác nhận §6 (OD-14).
- Đã chốt OD-09 và OD-10.

## 9. OPEN DECISION liên quan

| Mã | Câu hỏi |
| --- | --- |
| OD-09 | Hai ứng dụng dùng chung nhà cung cấp danh tính hay tách hẳn? |
| OD-10 | Thư viện bài hát: giữ hoàn toàn trong Koinonia (thiết kế hiện tại), hay tách thành một danh mục dùng chung mà cả hai cùng đọc? |
| OD-14 | Ánh xạ `Plan` vào cấu trúc project của Koinonia cần đối chiếu mã nguồn |
