# CONTEXT_ENGINE

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: `PRODUCT_MODEL.md`, `PERMISSION_MODEL.md`, `DATA_MODEL.md`

"Context Engine" là tên của một tập quy tắc truy vấn, không phải một dịch vụ hay một kho dữ liệu riêng. Không có đồ thị, không có suy luận, không có AI (AD-09, AD-21).

## 1. Bốn nguồn ngữ cảnh

| Nguồn | Trả lời | Lưu ở | Tạo bởi |
| --- | --- | --- | --- |
| **Anchor** | Cuộc trao đổi này thuộc về đối tượng nào | `conversations.anchor_type/anchor_id` | Hệ thống, khi tạo Conversation |
| **Link** | Đối tượng nào nhắc tới / sinh ra từ đối tượng nào | `links` | Hệ thống hoặc người dùng |
| **Vai trò** | Người nào liên quan tới đối tượng nào | `assignments`, `event_owners`, `tasks`, `task_collaborators`, `message_mentions` | Lệnh nghiệp vụ |
| **Lịch sử** | Đối tượng đã thay đổi thế nào | `activity_events` | Mọi lệnh |

Ngữ cảnh của một đối tượng = hợp của bốn nguồn, sau khi lọc quyền.

## 2. Link

### 2.1 Định nghĩa

`Link(from_type, from_id) --relation--> (to_type, to_id)`, kèm `origin`, `created_by`, `created_at`, `deleted_at`.

- Có hướng, nhưng **luôn truy vấn được cả hai chiều** (chỉ mục trên cả hai đầu).
- Cả hai đầu phải cùng `org_id`.
- Một Link không mang quyền (xem `PERMISSION_MODEL.md` §6).

### 2.2 Loại quan hệ

| `relation` | from → to | Nghĩa | Phạm vi |
| --- | --- | --- | --- |
| `references` | `message` → `event` \| `task` \| `group` | Tin nhắn nhắc tới đối tượng (qua thẻ hoặc đường dẫn) | `[MVP]` |
| `references` | `event` \| `task` → `event` \| `task` | Hai đối tượng công việc liên quan nhau (ví dụ buổi tập ↔ buổi chính) | `[MVP]` |
| `created_from` | `task` → `message` | Task được tạo từ tin nhắn này | `[MVP]` |
| `resolution` | `message` → `event` \| `task` \| `group` | Tin nhắn được đánh dấu "đã chốt" cho đối tượng | `[S]` |
| `blocks` | `task` → `task` | Task nguồn chặn Task đích | `[S]` |

Mọi cặp `(relation, from_type, to_type)` ngoài bảng này bị từ chối. `user` không bao giờ là một đầu của Link.

### 2.3 Nguồn gốc

| `origin` | Khi nào |
| --- | --- |
| `system` | Sinh ra như hệ quả của một lệnh khác: tạo Task từ tin nhắn; nhận diện đường dẫn nội bộ trong tin nhắn |
| `manual` | Người dùng chủ động chèn thẻ hoặc bấm "Liên kết" |

Tập giá trị `origin` có thể mở rộng về sau. Không định nghĩa trước giá trị nào khác.

### 2.4 Vòng đời

| Sự kiện | Hành vi | ActivityEvent |
| --- | --- | --- |
| Tạo | Kiểm tra quyền (§5); nếu đã tồn tại Link đang hiệu lực cùng khoá → trả về Link cũ (idempotent) | `context.linked` |
| Gỡ | Xoá mềm (`deleted_at`) | `context.unlinked` |
| Tin nhắn nguồn bị xoá | Link `references`/`resolution` từ tin đó bị xoá mềm theo. Link `created_from` trỏ tới tin đó **giữ lại**; giao diện hiện "Tin nhắn gốc không khả dụng" | `context.unlinked` (cause = `message.deleted`) |
| Đối tượng đích bị huỷ | Link giữ nguyên; đối tượng huỷ vẫn mở được ở chế độ chỉ-đọc | — |
| Sửa tin nhắn | So sánh tập thẻ trước/sau: thêm → tạo Link; bớt → gỡ Link | `context.linked` / `context.unlinked` |

Khoá duy nhất của Link đang hiệu lực: `(from_type, from_id, to_type, to_id, relation)`.

## 3. Truy xuất

Mọi truy vấn dưới đây nhận `viewer` và chỉ trả về mục mà `can(viewer, view, mục)` đúng. Mục bị lọc không trả về dưới bất kỳ dạng nào, ngoại trừ một số đếm tổng "n mục bạn không có quyền xem" ở khối Liên quan.

### 3.1 Theo Event

| Phần | Nguồn |
| --- | --- |
| Phân công hiện tại | `positions` + `assignments` của Event |
| Việc | `tasks` có `event_id` |
| Thảo luận | Conversation có anchor là Event |
| Tin nhắn nhắc tới | `links` có `to = event`, `relation ∈ {references, resolution}`, `from_type = message` |
| Đối tượng liên quan | `links` nối Event với Event/Task khác, **cả hai chiều** |
| Tệp | `attachments` có owner là Event, cộng tệp trong Conversation của Event |
| Lịch sử | `activity_events` có `event_id` |

### 3.2 Theo Task

| Phần | Nguồn |
| --- | --- |
| Nguồn gốc | `links` có `from = task`, `relation = created_from` → tin nhắn gốc và Conversation chứa nó |
| Thuộc về | `tasks.event_id` hoặc `tasks.group_id` |
| Thảo luận | Conversation có anchor là Task |
| Tin nhắn nhắc tới | `links` có `to = task`, `from_type = message` |
| Đối tượng liên quan | `links` nối Task với Event/Task khác, cả hai chiều; `[S]` `blocks` |
| Tệp | `attachments` của Task và trong Conversation của Task |
| Lịch sử | `activity_events` có `task_id` |

### 3.3 Theo Group

| Phần | Nguồn |
| --- | --- |
| Thảo luận | Conversation có anchor là Group |
| Buổi liên quan | `event_groups` |
| Việc của nhóm | `tasks` có `group_id` |
| Việc sinh ra từ hội thoại nhóm | `links` `created_from` trỏ tới tin nhắn trong Conversation của Group |
| `[S]` Đã chốt | `links` có `relation = resolution`, `to = group` |
| Lịch sử | `activity_events` có `group_id` |

### 3.4 Theo thành viên

Hai góc nhìn, khác nhau về quyền:

| Góc nhìn | Ai xem | Nội dung |
| --- | --- | --- |
| Của chính mình | Chính người đó | Assignment, Task (owner, collaborator, assigned_by), tin nhắn mention mình, Subscription. Đây là dữ liệu của My Workspace |
| Về người khác | Người xem bất kỳ | Assignment sắp tới và Task của người đó, **giới hạn trong các đối tượng người xem được phép thấy**. Không có mention, không có lịch sử phản hồi |
| `[S]` Lịch sử phục vụ | `position_managers`, org admin, chính người đó | Assignment đã qua theo Position |

Không có truy vấn "mọi tin nhắn của người X".

### 3.5 Hai chiều

Yêu cầu "truy xuất hai chiều" được thoả bởi ba cặp:

| Chiều đi | Chiều về |
| --- | --- |
| Tin nhắn → đối tượng nó nhắc tới (thẻ trong tin) | Đối tượng → các tin nhắn nhắc tới nó (khối Liên quan) |
| Task → tin nhắn gốc | Tin nhắn → Task sinh ra từ nó (thẻ dưới tin nhắn) |
| Đối tượng → Conversation của nó (anchor) | Conversation → đối tượng anchor (tiêu đề hội thoại) |

### 3.6 Độ sâu

Mọi truy xuất là **một bước** từ đối tượng đang xem. Ngoại lệ duy nhất: trang Event gộp tệp của các Task thuộc Event (hai bước, có giới hạn). Không có duyệt bắc cầu tổng quát.

## 4. Lịch sử

- Nguồn duy nhất: `activity_events`. Không có bảng lịch sử riêng theo entity.
- Mỗi ActivityEvent mang các cột ngữ cảnh (`event_id`, `task_id`, `group_id`, `conversation_id`) được điền khi ghi, để truy vấn lịch sử theo đối tượng cha không cần join.
- Dòng thời gian của Event gồm cả sự kiện của Position, Assignment và Task con.
- Hiển thị: ai, khi nào, làm gì, giá trị trước → sau (với các trường có lưu `before/after`).
- Lọc quyền: lịch sử của một đối tượng chỉ hiện với người xem được đối tượng đó; trường nhạy cảm trong payload (`decline_reason`) bị che với người không có quyền xem trường đó.
- Thay đổi do hệ quả hiển thị lồng dưới nguyên nhân gốc (theo `cause_id`).

## 5. Quyền

| Hành động | Điều kiện |
| --- | --- |
| Tạo Link `references` từ tin nhắn | Được ghi vào Conversation chứa tin **và** xem được đối tượng đích |
| Tạo Link giữa hai đối tượng công việc | Sửa được ít nhất một đầu **và** xem được đầu kia |
| Tạo `created_from` | Chỉ hệ thống, như một phần của lệnh tạo Task từ tin nhắn |
| Tạo `resolution` `[S]` | Người quản lý đối tượng đích (trưởng nhóm, `event_owners`, người giao/owner Task) |
| Gỡ Link | Người tạo Link, hoặc người quản lý một trong hai đầu |
| Xem Link | Xem được **cả hai** đầu. Xem được một đầu → thấy thẻ "Nội dung bị giới hạn" hoặc chỉ được tính vào số đếm |

Tạo Task từ tin nhắn không sao chép nội dung tin vào Task, trừ khi người tạo giữ nguyên tiêu đề/mô tả được điền sẵn. Khi đó nội dung trở thành dữ liệu của Task và tuân theo quyền của Task; đây là hành vi sao chép có chủ ý của người có quyền đọc tin nhắn.

## 6. Tìm kiếm `[S]`

| Khía cạnh | Quy tắc |
| --- | --- |
| Đối tượng được lập chỉ mục | Event (tên, mô tả, địa điểm), Task (tiêu đề, mô tả), Message `kind = user` chưa xoá (nội dung), Group (tên), User (tên hiển thị) |
| Chuẩn hoá tiếng Việt | Chữ thường, chuẩn hoá Unicode về NFC rồi bỏ dấu thanh và dấu phụ, `đ → d`. Lưu song song bản gốc và bản chuẩn hoá. Truy vấn được chuẩn hoá cùng cách |
| Lọc quyền | Áp **trước** khi xếp hạng và phân trang, dùng đúng các vị từ xem trong `PERMISSION_MODEL.md` §3. Không có bước lọc sau |
| Kết quả | Nhóm theo kiểu; mỗi mục kèm ngữ cảnh cha (Event/Group). Không trả tổng số gồm mục bị ẩn |
| Tin nhắn | Chạm vào kết quả → mở Conversation tại `seq` của tin |
| Cập nhật chỉ mục | Theo ActivityEvent tương ứng; tin nhắn bị xoá bị gỡ khỏi chỉ mục ngay |
| Ngoài phạm vi | Tìm trong tệp đính kèm; tìm theo ngữ nghĩa |

MVP: chỉ có lọc theo tên trên danh sách Event và danh sách Group/thành viên.

## 7. Điều kiện để xem xét lại thiết kế

Chỉ cân nhắc cơ chế phức tạp hơn (duyệt nhiều bước, lớp đồ thị) khi có bằng chứng sử dụng cho thấy người dùng thường xuyên cần đi qua từ ba bước trở lên giữa các đối tượng. Chưa có bằng chứng nào như vậy.
