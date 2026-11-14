# EVENT_API_CONTRACTS

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: `PRODUCT_MODEL.md`, `DATA_MODEL.md`, `PERMISSION_MODEL.md`, `NOTIFICATION_ENGINE.md`

Contract ở mức logic. Đường dẫn và định dạng mang tính minh hoạ cho một API kiểu tài nguyên; giao thức truyền tải cụ thể chưa chọn (OD-13).

## 1. Sự kiện miền (Domain Event)

### 1.1 Phong bì

Mỗi sự kiện miền là một dòng `activity_events`:

| Trường | Nghĩa |
| --- | --- |
| `id`, `seq` | Định danh và thứ tự toàn cục |
| `org_id` | Tenant |
| `verb` | Tên sự kiện, dạng `đối_tượng.động_từ_quá_khứ` |
| `actor` | `{type: user \| system, id?}` |
| `object` | `{type, id}` |
| `context` | `{event_id?, task_id?, group_id?, conversation_id?}` |
| `cause_id` | Sự kiện gốc, nếu sự kiện này là hệ quả |
| `payload` | Theo bảng §2 |
| `request_id` | Khoá idempotent của lệnh |
| `occurred_at` | |

### 1.2 Quy tắc phát

1. Sự kiện được ghi **trong cùng giao dịch** với thay đổi dữ liệu. Không có thay đổi nào không có sự kiện, không có sự kiện nào cho thay đổi bị huỷ.
2. Một lệnh có thể sinh một sự kiện gốc và nhiều sự kiện con; con mang `cause_id` = gốc.
3. Payload chứa định danh và giá trị `before/after` của trường thay đổi. Không chứa nội dung tin nhắn.
4. Người nhận đích danh được ghi rõ trong payload (ví dụ `assignee_id`), để bộ tiêu thụ không phụ thuộc trạng thái về sau.

### 1.3 Bộ tiêu thụ

| Bộ tiêu thụ | Việc | `[MVP]` |
| --- | --- | --- |
| `notifier` | Sinh Notification và delivery theo `NOTIFICATION_ENGINE.md` | ✔ |
| `projector` | Chiếu dòng `system` vào Conversation liên quan | ✔ |
| `realtime` | Đẩy thay đổi tới client đang kết nối | ✔ |
| `indexer` | Cập nhật chỉ mục tìm kiếm | `[S]` |
| `scheduler` | Lên lịch/huỷ nhắc việc | `[S]` |

### 1.4 Xử lý lỗi phía tiêu thụ

| Tình huống | Hành vi |
| --- | --- |
| Giao lại (at-least-once) | Mỗi bộ tiêu thụ idempotent theo `activity_events.id`: `notifier` nhờ UNIQUE `(user_id, root_activity_id)` và khoá chính của `notification_items`; `projector` nhờ UNIQUE `(conversation_id, activity_event_id)` |
| Sai thứ tự | Bộ tiêu thụ đọc theo `seq` tăng dần trong từng tổ chức. Khi cần trạng thái (tập người phụ trách, người theo dõi), đọc trạng thái hiện tại rồi kiểm tra lại tính còn hiệu lực trước khi gửi |
| Lỗi tạm thời | Thử lại có giãn cách; sự kiện giữ `dispatched_at` null |
| Lỗi lặp lại | Sau `N` lần, chuyển vào hàng cách ly, cảnh báo vận hành; các sự kiện sau **vẫn tiếp tục** được xử lý. Vì hộp thông báo là hình chiếu, My Workspace và trang đối tượng vẫn đúng |
| Bộ tiêu thụ ngừng lâu | Dữ liệu nghiệp vụ không bị ảnh hưởng; thông báo đến trễ. Khi phục hồi, bỏ qua delivery cho bản ghi đã không còn hiệu lực |

## 2. Danh mục sự kiện

Nguồn phát là module trong `PRODUCT_MODEL.md`. Người nhận: xem ma trận trong `NOTIFICATION_ENGINE.md` §5.

### 2.1 Identity

| Verb | Phát khi | Payload chính |
| --- | --- | --- |
| `organization.created` | Tạo tổ chức | `name` |
| `organization.updated` | Sửa thông tin/mặc định | `changes{field: {before, after}}` |
| `member.invited` | Tạo liên kết mời | `invite_id`, `role`, `group_id?` |
| `invite.revoked` | Thu hồi liên kết mời | `invite_id` |
| `member.joined` | Nhận lời mời | `user_id`, `role`, `invite_id`, `group_id?` |
| `member.removed` | Rời hoặc bị gỡ. Sự kiện con: `group.member_removed`, `assignment.cancelled` (`member_left`), `task.assigned` (`to_owner_id` rỗng), `event.owner_changed` | `user_id`, `by_self : bool` |
| `member.role_changed` | Đổi vai trò tổ chức | `user_id`, `before`, `after` |
| `group.created` | | `name` |
| `group.updated` | | `changes` |
| `group.archived` | | |
| `group.member_added` | | `user_id`, `role` |
| `group.member_removed` | | `user_id`, `by_self` |
| `group.member_role_changed` | | `user_id`, `before`, `after` |

### 2.2 Scheduling

| Verb | Phát khi | Payload chính | Sự kiện con có thể có |
| --- | --- | --- | --- |
| `event.created` | Tạo bản nháp | `title`, `starts_at`, `ends_at`, `template_id?`, `copied_from?` | |
| `event.published` | `draft → published` | `starts_at`, `ends_at`, `location`, `group_ids` | `assignment.requested` cho từng Assignment `draft` |
| `event.updated` | Sửa trường không phải thời gian/địa điểm; đổi `event_groups`, `visibility` | `changes`, `notify_assignees : bool` | |
| `event.rescheduled` | Đổi `starts_at`/`ends_at` của Event đã publish | `before{starts_at, ends_at}`, `after{…}`, `delta_min`, `reason?` | `assignment.reconfirm_requested`, `task.due_changed` |
| `event.relocated` | Đổi `location` của Event đã publish | `before`, `after` | |
| `event.cancelled` | `published → cancelled` | `reason?`, `active_assignee_ids` (chụp trước khi huỷ) | `assignment.cancelled` (`event_cancelled`), `task.cancelled` |
| `event.owner_changed` | Thêm/gỡ người phụ trách | `added[]`, `removed[]` | |
| `event.plan_changed` `[S]` | Đổi dòng chương trình | `plan_version` | |
| `position.created` | | `name`, `group_id?`, `slots`, `report_offset_min` | |
| `position.updated` | | `changes` | |
| `position.removed` | | | `assignment.cancelled` (`position_removed`) |
| `assignment.requested` | Assignment vào `requested` | `assignee_id`, `position_id`, `requested_by`, `replaces_assignment_id?` | |
| `assignment.accepted` | | `assignee_id`, `position_id`, `responded_by`, `from_status` | |
| `assignment.declined` | | `assignee_id`, `position_id`, `responded_by`, `from_status`, `reason` (trường hạn chế) | |
| `assignment.reconfirm_requested` | `accepted → reconfirm` | `assignee_id`, `position_id` | |
| `assignment.cancelled` | | `assignee_id`, `position_id`, `cancel_reason`, `from_status`, `replaced_by_assignment_id?` | |

Sửa Event `draft` chỉ phát `event.updated`/`position.*`; không phát sự kiện Assignment cho tới khi publish.

### 2.3 Tasks

| Verb | Phát khi | Payload chính |
| --- | --- | --- |
| `task.created` | | `title`, `scope_type`, `event_id?`, `group_id?`, `due_at?`, `source_message_id?` |
| `task.updated` | Sửa tiêu đề/mô tả | `changes` (không gồm nội dung mô tả; chỉ đánh dấu trường đã đổi) |
| `task.assigned` | `owner_id` thay đổi, kể cả về null | `from_owner_id?`, `to_owner_id?`, `assigned_by`, `requires_acceptance` |
| `task.accepted` | `acceptance → accepted` | `owner_id` |
| `task.declined` | `acceptance → declined` | `owner_id`, `reason?` |
| `task.status_changed` | `open ↔ in_progress` | `before`, `after` |
| `task.completed` | `→ done` | `completed_by` |
| `task.reopened` | `done → open` | |
| `task.cancelled` | `→ cancelled` | `reason?` |
| `task.due_changed` | `due_at` đổi | `before`, `after`, `by_reschedule : bool` |
| `task.flag_changed` | Bật/tắt cờ | `flag`, `value` |
| `task.collaborator_added` | | `user_id` |
| `task.collaborator_removed` | | `user_id`, `by_self` |
| `task.overdue` `[S]` | Tới `due_at` mà chưa xong (actor `system`) | `due_at`, `owner_id` |

Tạo Task có sẵn người phụ trách phát `task.created` (gốc) và `task.assigned` (con).

### 2.4 Messaging

| Verb | Phát khi | Payload chính |
| --- | --- | --- |
| `message.created` | Gửi tin `kind = user` | `message_id`, `seq`, `sender_id`, `mention_ids[]`, `reply_to_sender_id?`, `has_attachments` |
| `message.edited` | | `message_id`, `added_mention_ids[]`, `removed_mention_ids[]` |
| `message.deleted` | | `message_id`, `deleted_by` |
| `attachment.added` | Thêm tệp vào Event/Task | `attachment_id`, `owner{type, id}` |
| `attachment.removed` | | `attachment_id`, `owner` |

Tin `system` không phát `message.created`.

### 2.5 Links

| Verb | Phát khi | Payload chính |
| --- | --- | --- |
| `context.linked` | Tạo Link | `link_id`, `from{type,id}`, `to{type,id}`, `relation`, `origin` |
| `context.unlinked` | Gỡ Link | `link_id`, `from`, `to`, `relation` |

### 2.6 Hệ thống `[S]`

| Verb | Phát khi | Payload chính |
| --- | --- | --- |
| `reminder.fired` | Tới giờ nhắc | `kind : response_pending \| event_soon \| due_soon`, `target_user_id`, `object` |
| `escalation.raised` | Quá hạn phản hồi | `pending_user_id`, `object`, `recipient_ids[]` |

## 3. Sự kiện tới client (realtime)

Không lưu, không phải sự kiện miền. Mất gói được bù bằng cách client tải lại khi kết nối lại.

| Sự kiện | Gửi tới | Payload | Client làm gì |
| --- | --- | --- | --- |
| `notification.created` | Chủ bản ghi | `notification_id`, `class`, `object`, `action_state` | Thêm vào hộp thông báo, cập nhật huy hiệu |
| `notification.updated` | Chủ bản ghi | `notification_id`, `class`, `action_state`, `read` | Cập nhật mục (gộp, đã xử lý, bị thay thế) |
| `conversation.message` | Người đang có quyền đọc và đang kết nối | `conversation_id`, `message_id`, `seq` | Tải tin mới |
| `conversation.message_changed` | Như trên | `conversation_id`, `message_id`, `change : edited \| deleted` | Cập nhật tin |
| `object.changed` | Người đang mở đối tượng | `object{type,id}`, `version` | Tải lại nếu `version` mới hơn |
| `access_changed` | Người vừa mất (hoặc được) quyền, trên kênh `user:{id}` (AD-31) | `type`, `id`, `activity_id` | Làm mới JWT, `realtime.setAuth`, đóng màn hình mất quyền, xoá bộ nhớ đệm |

`notification.created` là đầu ra của `notifier`; nó **không** quay lại thành ActivityEvent.

## 4. Quy ước API

| Chủ đề | Quy ước |
| --- | --- |
| Xác thực | Mọi lệnh mang danh tính người dùng; máy chủ xác định Membership theo `org_id` của tài nguyên |
| Phân quyền | Mọi lệnh gọi `can(user, action, object)` trước khi đọc/ghi |
| Idempotency | Lệnh ghi nhận khoá `Idempotency-Key`. Lặp lại cùng khoá trong 24 giờ trả kết quả lần đầu, không ghi thêm |
| Đồng thời | Lệnh sửa đối tượng có `version` phải gửi `expected_version`. Lệch → `version_conflict` kèm bản hiện tại |
| Chuyển trạng thái | Lệnh chuyển trạng thái gửi `expected_status`. Lệch → `state_conflict` kèm trạng thái hiện tại |
| Phân trang | Con trỏ; tin nhắn theo `seq` |
| Thời gian | ISO 8601 UTC |

Mã lỗi:

| Mã | Nghĩa | Client nên |
| --- | --- | --- |
| `validation_failed` | Dữ liệu vào sai; kèm danh sách trường | Hiện lỗi tại trường |
| `unauthenticated` | Chưa đăng nhập/hết phiên | Đăng nhập lại |
| `not_found` | Không tồn tại **hoặc không có quyền xem** | Hiện "Nội dung không khả dụng" |
| `forbidden` | Xem được nhưng không được làm hành động này | Ẩn hành động, báo ngắn |
| `version_conflict` | Đối tượng đã đổi | Hiện bản mới, cho áp lại |
| `state_conflict` | Trạng thái không còn như mong đợi | Hiện trạng thái mới |
| `invalid_transition` | Chuyển trạng thái không hợp lệ | Báo lỗi |
| `position_full` | Vị trí đã đủ người | Gợi ý tăng `slots` |
| `duplicate_assignment` | Người này đã có Assignment đang hiệu lực ở vị trí này | Báo |
| `not_a_member` | Người được chọn không phải thành viên `active` | Báo |
| `read_only` | Hội thoại/đối tượng đã đóng | Tắt ô nhập |
| `rate_limited` | Quá tần suất | Thử lại sau |

## 5. Lệnh quan trọng

### 5.1 Publish Event

`POST /v1/events/{id}/publish`

| | |
| --- | --- |
| Vào | `expected_version` |
| Quyền | Sửa Event (`PERMISSION_MODEL.md` §4.4) |
| Điều kiện | `status = draft`; có ≥ 1 `event_owners` |
| Hành vi | `status → published`; tạo Conversation của Event; mọi Assignment `draft` → `requested` |
| Sự kiện | `event.published` (gốc) + `assignment.requested` × n (con) |
| Ra | Event, số Assignment đã gửi |
| Lỗi | `not_found`, `forbidden`, `version_conflict`, `invalid_transition` |

### 5.2 Tạo Assignment

`POST /v1/positions/{id}/assignments`

| | |
| --- | --- |
| Vào | `user_id` |
| Quyền | `position_manager` |
| Hành vi | Khoá dòng Position; kiểm tra `slots`, trùng, Membership. Event `draft` → Assignment `draft` (không sự kiện). Event `published` → `requested` |
| Sự kiện | `assignment.requested` (nếu `requested`) |
| Ra | Assignment; `warnings[]` (ví dụ `overlapping_assignment` kèm Event trùng giờ) |
| Lỗi | `position_full`, `duplicate_assignment`, `not_a_member`, `invalid_transition` (Event đã huỷ) |

### 5.3 Trả lời Assignment

`POST /v1/assignments/{id}/respond`

| | |
| --- | --- |
| Vào | `response : accept \| decline`, `reason` (bắt buộc khi `decline`), `expected_status` |
| Quyền | `assignee`, hoặc `position_manager` (trả lời hộ) |
| Hành vi | Chuyển theo máy trạng thái; ghi `responded_by`, `responded_at` |
| Sự kiện | `assignment.accepted` hoặc `assignment.declined` |
| Idempotent | Gửi lại cùng `response` khi đã ở trạng thái đích → thành công, không sự kiện mới |
| Lỗi | `state_conflict` (đã bị huỷ/đổi), `validation_failed` (thiếu lý do), `forbidden` |

### 5.4 Thay người

`POST /v1/assignments/{id}/replace`

| | |
| --- | --- |
| Vào | `new_user_id`, `expected_status` |
| Quyền | `position_manager` |
| Hành vi | Một giao dịch: Assignment cũ → `cancelled` (`replaced`); tạo Assignment mới `requested` với `replaces_assignment_id` |
| Sự kiện | `assignment.cancelled` (gốc) + `assignment.requested` (con) |
| Lỗi | `state_conflict`, `duplicate_assignment`, `not_a_member` |

Gỡ không thay: `POST /v1/assignments/{id}/cancel` → `assignment.cancelled` (`removed`).

### 5.5 Dời lịch

`POST /v1/events/{id}/reschedule`

| | |
| --- | --- |
| Vào | `starts_at`, `ends_at`, `reason?`, `expected_version` |
| Quyền | Sửa Event |
| Điều kiện | `status = published` |
| Hành vi | Cập nhật thời gian; áp bảng trong `NOTIFICATION_ENGINE.md` §8.5 trong cùng giao dịch |
| Sự kiện | `event.rescheduled` (gốc) + `assignment.reconfirm_requested` × n + `task.due_changed` × m (con) |
| Ra | Event; `summary{reconfirm_count, notified_count, tasks_shifted, tasks_absolute_due[]}` |
| Lỗi | `version_conflict`, `invalid_transition`, `validation_failed` |

`[S]` Xem trước: `POST /v1/events/{id}/reschedule/preview` nhận cùng đầu vào, trả cùng `summary` kèm danh sách chi tiết, không ghi gì.

Đổi địa điểm: `POST /v1/events/{id}/relocate` → `event.relocated`. Huỷ: `POST /v1/events/{id}/cancel` → `event.cancelled` + con.

### 5.6 Tạo Task (kể cả từ tin nhắn)

`POST /v1/tasks`

| | |
| --- | --- |
| Vào | `title`, `description?`, `scope{type, event_id? \| group_id?}`, `owner_id?`, `requires_acceptance?`, `due_at? \| due_offset_min?`, `source_message_id?` |
| Quyền | Theo bảng tạo Task (`PERMISSION_MODEL.md` §4.6). Nếu có `source_message_id`: phải đọc được tin nhắn đó |
| Hành vi | Tạo Task; ép `requires_acceptance` theo AD-16; nếu có `source_message_id`: tạo Link `created_from` (`origin = system`); `scope` mặc định theo anchor của hội thoại chứa tin nhắn |
| Sự kiện | `task.created` (gốc) + `task.assigned` (con, nếu có owner) + `context.linked` (con, nếu từ tin nhắn) |
| Lỗi | `validation_failed`, `forbidden`, `not_a_member`, `not_found` (tin nhắn) |

### 5.7 Giao lại Task

`POST /v1/tasks/{id}/assign`

| | |
| --- | --- |
| Vào | `owner_id` (hoặc null để bỏ giao), `expected_version` |
| Quyền | `task_manager` |
| Hành vi | Đổi `owner_id`, `assigned_by`; đặt `acceptance` = `pending` hoặc `none` |
| Sự kiện | `task.assigned` |
| Lỗi | `version_conflict`, `not_a_member`, `invalid_transition` (Task đã `done`/`cancelled`) |

Các lệnh khác của Task: `/respond` (`accept`/`decline`), `/status` (`in_progress`/`done`/`open`), `/cancel`, `/flags`, `/collaborators`; mỗi lệnh phát đúng một verb tương ứng ở §2.3.

### 5.8 Gửi tin nhắn

`POST /v1/conversations/{id}/messages`

| | |
| --- | --- |
| Vào | `client_msg_id`, `body`, `reply_to_id?`, `mention_ids[]`, `object_refs[]` (`{type, id}`), `attachment_ids[]` |
| Quyền | Gửi tin (`PERMISSION_MODEL.md` §4.3) |
| Hành vi | Cấp `seq`; lưu mention; mỗi `object_ref` → Link `references` (`origin = manual`); đường dẫn nội bộ nhận diện trong `body` → Link (`origin = system`) |
| Sự kiện | `message.created` (gốc) + `context.linked` × n (con) |
| Idempotent | Trùng `client_msg_id` → trả tin đã tạo |
| Lỗi | `read_only`, `validation_failed` (mention người không đọc được hội thoại; `reply_to_id` khác hội thoại), `not_found` (`object_ref` người gửi không xem được) |

## 6. Danh sách API còn lại

| Nhóm | Lệnh |
| --- | --- |
| Tổ chức | Tạo; sửa; tạo/thu hồi lời mời; nhận lời mời; đổi vai trò; gỡ thành viên; rời |
| Nhóm | Tạo; sửa; lưu trữ; thêm/gỡ thành viên; đổi vai trò |
| Event | Tạo (trống / từ mẫu / sao chép); sửa; xoá bản nháp; thêm/gỡ owner; Position: thêm/sửa/gỡ |
| Mẫu | Tạo; sửa; lưu trữ; tạo mẫu từ Event |
| Hội thoại | Liệt kê; lấy tin theo `seq`; sửa/xoá tin; đánh dấu đã đọc tới `seq` |
| Tệp | Xin địa chỉ tải lên; xác nhận; xin địa chỉ tải xuống; gỡ |
| Link | Tạo; gỡ; lấy ngữ cảnh của một đối tượng |
| Subscription | Đặt/bỏ theo đối tượng |
| Thông báo | Liệt kê; đánh dấu đã đọc; đánh dấu tất cả; lấy/sửa Preference; đăng ký/huỷ thiết bị |
| Cá nhân | Lấy dữ liệu My Workspace; hồ sơ; hồ sơ thành viên khác |
| Tìm kiếm `[S]` | Tìm theo từ khoá và kiểu |
| Tích hợp `[EXT]` | Xem `KOINONIA_INTEGRATION.md` |

Mọi lệnh ghi trong bảng này tuân theo §4 và phát các verb đã liệt kê ở §2; không lệnh nào phát verb ngoài danh mục.

## Phụ lục: Realtime và xác thực (AD-27, AD-28, OD-19)

- Backend là nơi duy nhất ghi `activity_events` (cùng giao dịch với lệnh). Máy khách nhận cập nhật qua Supabase Realtime.
- **Đã chốt (AD-31, thử nghiệm 2026-11-14):** Broadcast từ cơ sở dữ liệu bằng `realtime.send(payload, event, topic, true)` gọi trong cùng giao dịch với lệnh, trên kênh riêng `user:{id}`, `group:{id}` và `conversation:{id}` (anchor group từ S4; event/task bổ sung theo lát). Quyền nghe kiểm tra bằng policy `rt_receive_broadcast` trên `realtime.messages` (hàm `rt.can_read_topic`, `db/supabase/0002_realtime_authz.sql`). Máy khách không có quyền gửi broadcast.
- Realtime chỉ tính quyền khi join kênh và khi nhận JWT mới; giữa hai lần đó kết quả được lưu đệm. Đã đo: người bị gỡ khỏi nhóm vẫn nhận sự kiện của nhóm cho tới khi làm mới token; khi máy khách gửi JWT mới, Realtime đóng kênh ngay và join lại bị từ chối.
- Vì vậy, mọi lệnh làm mất quyền đọc (gỡ khỏi Group, gỡ khỏi Organization, đổi `visibility`) phát thêm sự kiện `access_changed` tới `user:{id}` của người bị ảnh hưởng. Máy khách khi nhận phải làm mới phiên (`refreshSession`) rồi `realtime.setAuth(token mới)`, xoá bộ nhớ đệm liên quan (T14). Máy khách không hợp tác bị giới hạn bởi thời gian sống JWT (đề xuất 10 phút, cấu hình ở Supabase Auth).
- Realtime là tín hiệu, không phải nguồn dữ liệu: sự kiện có thể mất (đã gặp khi dự án mới khởi tạo Realtime lần đầu). Máy khách tải lại qua API khi kết nối lại.
- Sự kiện realtime chỉ mang `{type, id, activity_id}`, không mang nội dung (AD-10); máy khách tải lại qua API.
- Mọi lệnh vẫn mang `Idempotency-Key` và `expected_version`; xác thực bằng `Authorization: Bearer <JWT Supabase>` kiểm tra tại Backend.
