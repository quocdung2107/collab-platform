# PRODUCT_MODEL

Phiên bản 0.1 · 2026-11-13 · Trạng thái: đặc tả, chưa triển khai

Tài liệu gốc của bộ đặc tả. Mọi tài liệu khác phải dùng đúng tên entity, trạng thái và verb định nghĩa ở đây và trong `DATA_MODEL.md`, `EVENT_API_CONTRACTS.md`.

## 0. Quy ước

| Ký hiệu | Nghĩa |
| --- | --- |
| `[MVP]` | Thuộc phạm vi MVP (Phase 1–2) |
| `[S]` | Should — Phase 3; MVP không được phụ thuộc |
| `[EXT]` | Mở rộng — Phase 4 trở đi |
| `AD-nn` | Quyết định kiến trúc, xem `ARCHITECTURE_DECISIONS.md` |
| `OD-nn` | OPEN DECISION, chưa đủ căn cứ để chốt |

Định danh (entity, cột, verb, trạng thái) viết bằng tiếng Anh; giải thích bằng tiếng Việt.

## 1. Nguyên tắc bất biến

1. Chat và Workspace ngang hàng về mô hình dữ liệu và điều hướng.
2. Chat và Workspace liên kết hai chiều.
3. Church-first; lõi không chứa khái niệm nhà thờ.
4. `Assignment` và `Task` là hai entity riêng.
5. Audience (do cấu trúc quyết định) tách khỏi Subscription (do người dùng chọn).
6. `ActivityEvent` là nguồn duy nhất cho lịch sử và sự kiện.
7. Context Link truy xuất được hai chiều.
8. Không có AI trong MVP; không thiết kế trước cho AI.
9. Koinonia và nền tảng này tách biệt, tích hợp qua contract.

## 2. Cấu trúc tổng thể

```
Organization
 ├─ Membership ── User
 ├─ Group ── GroupMember ── User
 │    └─ Conversation (anchor = group)
 ├─ Event ──< EventGroup >── Group          (N–N: các nhóm liên quan)
 │    ├─ EventOwner ── User
 │    ├─ Position ──< Assignment ── User
 │    ├─ Task (scope = event)
 │    └─ Conversation (anchor = event)
 ├─ Task (scope = group | private)
 │    ├─ TaskCollaborator ── User
 │    └─ Conversation (anchor = task)
 └─ xuyên suốt: Link · Attachment · Subscription · ActivityEvent · Notification
```

## 3. Entity và quan hệ

### 3.1 Organization, Membership `[MVP]`

- `Organization` là ranh giới tenant. Mọi dữ liệu nghiệp vụ mang `org_id`.
- `Membership(org_id, user_id, role, status)`; `role ∈ {owner, admin, member}`; `status ∈ {active, removed}`.
- Mọi người tham gia bất kỳ đối tượng nào đều phải có Membership `active` (AD-23). Khách ngoài tổ chức là `[EXT]`.
- Một User có thể thuộc nhiều Organization.

### 3.2 Group `[MVP]`

- Tập thành viên ổn định (ban, nhóm). `GroupMember.role ∈ {leader, member}`.
- Mỗi Group có đúng một Conversation mặc định, tạo cùng lúc với Group.
- Group **không sở hữu** Event. Group liên quan tới Event qua `EventGroup`.
- Tên Group và danh sách thành viên hiển thị với mọi thành viên Organization; nội dung hội thoại chỉ thành viên Group đọc được (OD-05 về nhóm ẩn).

### 3.3 Event `[MVP]`

- Một buổi/chương trình có thời gian, địa điểm. Thuộc Organization (AD-03).
- `status ∈ {draft, published, cancelled}`. "Đã diễn ra" là giá trị suy ra từ `ends_at`, không lưu.
- `visibility ∈ {org, groups}`. Mặc định `org` (OD-06).
- Quan hệ: N–N với Group; 1–N với Position, Task; N–N với User qua `EventOwner` (người phụ trách buổi).
- Nhiều giai đoạn: MVP dùng `Position.report_offset_min` (giờ có mặt tương đối so với `starts_at`). Buổi tập dượt là một Event riêng, nối bằng Link. Bảng mốc giờ riêng là `[EXT]` (AD-17).
- Dòng chương trình (`EventItem`) là `[S]`; xem `KOINONIA_INTEGRATION.md`.

### 3.4 Position, Assignment `[MVP]`

- `Position`: một vị trí cần người trong một Event (ví dụ "Âm thanh"), có `slots` (số người cần) và `group_id` tùy chọn (nhóm chịu trách nhiệm lấp vị trí).
- `Assignment`: một người được xếp vào một Position, kèm phản hồi của họ.
- Assignment **không phải** Task: không có hạn chót, không có tiến độ; nó là cam kết có mặt trong khung giờ của Event (AD-02).

Máy trạng thái Assignment:

| Từ | Sang | Ai | Verb |
| --- | --- | --- | --- |
| (tạo trong Event `draft`) | `draft` | người quản lý vị trí | — |
| `draft` / (tạo trong Event `published`) | `requested` | hệ thống khi publish / người quản lý vị trí | `assignment.requested` |
| `requested`, `reconfirm` | `accepted` | người được xếp, hoặc người quản lý vị trí trả lời hộ (AD-15) | `assignment.accepted` |
| `requested`, `accepted`, `reconfirm` | `declined` | như trên; bắt buộc có lý do | `assignment.declined` |
| `accepted` | `reconfirm` | hệ thống, khi Event dời giờ vượt ngưỡng | `assignment.reconfirm_requested` |
| `draft`, `requested`, `accepted`, `reconfirm` | `cancelled` | người quản lý vị trí / hệ thống | `assignment.cancelled` |

- `declined` và `cancelled` là trạng thái cuối. Mời lại là tạo Assignment mới (AD-14).
- `cancel_reason ∈ {removed, replaced, event_cancelled, position_removed, member_left}`.
- Trạng thái "đang hiệu lực" = `{draft, requested, accepted, reconfirm}`. Một người có tối đa một Assignment đang hiệu lực trên một Position.
- Thay người = huỷ Assignment cũ (`replaced`) + tạo Assignment mới có `replaces_assignment_id`, trong một giao dịch.

### 3.5 Task `[MVP]`

- Một việc có một người chịu trách nhiệm chính (`owner_id`) và tùy chọn có hạn.
- Phạm vi (`scope_type`), đúng một trong ba:
  - `event`: thuộc một Event (`event_id`).
  - `group`: thuộc một Group (`group_id`), thường sinh từ hội thoại nhóm.
  - `private`: chỉ người tham gia thấy.
- Người tham gia: `owner_id` (0..1), `assigned_by` (người giao gần nhất), `TaskCollaborator` (0..n).
- Hạn: `due_at` tuyệt đối, hoặc `due_offset_min` tương đối so với `Event.starts_at` (chỉ khi `scope_type = event`); khi có offset, `due_at` được tính lại mỗi lần Event dời giờ.

Bốn chiều trạng thái, độc lập nhau:

| Chiều | Giá trị | Ghi chú |
| --- | --- | --- |
| `status` | `open → in_progress → done`; `open/in_progress → cancelled`; `done → open` (mở lại) | |
| `acceptance` | `none`, `pending`, `accepted`, `declined` | `none` khi `requires_acceptance = false` |
| cờ | `blocked`, `needs_help` | boolean |
| suy ra | quá hạn = `due_at < now` và `status ∈ {open, in_progress}` | không lưu |

- Đổi `owner_id` luôn phát `task.assigned`; nếu `requires_acceptance` thì `acceptance` về `pending`.
- Giao cho người khác mà người giao không có quyền quản lý phạm vi → `requires_acceptance` bị ép `true` (AD-16).
- `acceptance = declined`: `owner_id` giữ nguyên để truy vết, Task được coi là "cần phân công lại".
- "Mỗi người đều phải làm" = tạo N Task, mỗi Task một owner. Không có Task đa-owner.
- Phụ thuộc giữa các Task: `[S]`, dùng Link `relation = blocks`.

### 3.6 Conversation, Message `[MVP]`

- `Conversation` là entity độc lập của module Messaging, luôn có đúng một **anchor** `(anchor_type, anchor_id)` với `anchor_type ∈ {group, event, task}`.
- Mỗi anchor có tối đa một Conversation. Group: tạo cùng Group. Event: tạo khi publish. Task: tạo khi có tin nhắn đầu tiên.
- `Message.kind ∈ {user, system}`. Tin `system` là hình chiếu của một ActivityEvent vào hội thoại; không sửa, không xoá, không mention.
- Thứ tự tin nhắn theo `seq` tăng dần trong từng Conversation.

### 3.7 Các entity xuyên suốt `[MVP]`

| Entity | Vai trò | Tài liệu |
| --- | --- | --- |
| `Link` | Quan hệ có hướng giữa hai đối tượng bất kỳ | `CONTEXT_ENGINE.md` |
| `Attachment` | Tệp gắn vào Message, Event hoặc Task. Đây là "Document" của MVP (AD-19) | `PERMISSION_MODEL.md` |
| `Subscription` | Lựa chọn theo dõi / tắt tiếng của người dùng | `NOTIFICATION_ENGINE.md` |
| `ActivityEvent` | Nhật ký append-only của mọi thay đổi | `EVENT_API_CONTRACTS.md` |
| `Notification` | Mục trong hộp thông báo của một người | `NOTIFICATION_ENGINE.md` |
| `EventTemplate` | Mẫu dựng Event | `DATA_MODEL.md` |

### 3.8 Sổ đăng ký kiểu đối tượng

Mọi tham chiếu đa hình `(type, id)` chỉ dùng các giá trị sau (AD-04):

`organization`, `group`, `event`, `position`, `assignment`, `task`, `conversation`, `message`, `attachment`, `user`.

## 4. Chat độc lập đến mức nào

| Khía cạnh | Độc lập? | Diễn giải |
| --- | --- | --- |
| Entity và module | Có | Messaging không gọi Scheduling/Tasks; chỉ biết anchor dưới dạng `(type, id)` |
| Điều hướng | Có | Tab Chat ngang hàng tab Lịch; liệt kê mọi Conversation người dùng đọc được |
| Vòng đời | Có | Conversation tồn tại sau khi anchor bị huỷ (chuyển chỉ-đọc), không bị xoá theo |
| Lưu trữ, tìm kiếm | Có | Bảng riêng, chỉ mục riêng |
| Quyền đọc/ghi | Không | Suy ra từ anchor qua module Access; không có bảng thành viên hội thoại trong MVP |
| Tồn tại không anchor | Không (MVP) | DM và nhóm chat tự do là `[EXT]`: thêm `anchor_type = direct` và bảng thành viên, không đổi mô hình |
| Thay đổi dữ liệu công việc | Không | Tin nhắn không bao giờ làm đổi trạng thái Event/Assignment/Task |

Lý do không có hội thoại tự do trong MVP: xem AD-01. Đây là giới hạn phạm vi, không phải giới hạn mô hình.

## 5. Nơi lưu thảo luận

| Thảo luận về | Nơi lưu | Ai đọc/viết |
| --- | --- | --- |
| Chuyện chung của nhóm | Conversation của Group | Thành viên Group |
| Một buổi cụ thể | Conversation của Event | Ai xem được Event |
| Một việc cụ thể | Conversation của Task | Ai xem được Task |
| Một buổi, nhưng nói trong chat nhóm | Conversation của Group, tin nhắn có Link tới Event | Thành viên Group; Event hiển thị tin đó trong "Liên quan" nếu người xem đọc được hội thoại nhóm |

Không có "bình luận" tách khỏi Conversation. Một đối tượng công việc có đúng một luồng thảo luận.

## 6. Một tin nhắn liên kết nhiều đối tượng

- Ngữ cảnh ngầm định: anchor của Conversation chứa tin nhắn. Không lưu thành Link.
- Ngữ cảnh tường minh: mỗi đối tượng được nhắc tới là một dòng `Link(from = message, to = object, relation = references)`. Một tin nhắn có 0..n Link.
- Cách tạo:
  - Chèn thẻ đối tượng khi soạn tin → `origin = manual`.
  - Tạo Task từ tin nhắn → `Link(from = task, to = message, relation = created_from, origin = system)`.
  - Dán đường dẫn nội bộ tới đối tượng → `origin = system`.
- Nhắc tên người (mention) **không** là Link; lưu ở `MessageMention` vì nó mang nghĩa thông báo, không mang nghĩa ngữ cảnh (AD-09).

## 7. Dữ liệu chính thức và trao đổi thông thường

| | Chính thức | Trao đổi |
| --- | --- | --- |
| Nơi ở | Trường dữ liệu của Event, Position, Assignment, Task | `Message.body` |
| Trả lời câu hỏi | "Hiện tại là gì?" | "Đã nói gì?" |
| Thay đổi | Qua lệnh (command), kiểm tra quyền, sinh ActivityEvent | Sửa/xoá tin nhắn của chính mình |
| Lịch sử | Đầy đủ, không xoá | Xoá mềm, nội dung bị gỡ |
| Sinh thông báo trách nhiệm | Có | Không (chỉ mention) |

Quy tắc:

1. Không lệnh nào suy ra từ nội dung tin nhắn.
2. Nút trên thẻ đối tượng trong chat (Nhận, Từ chối, Xong) gọi cùng một lệnh như trên trang đối tượng.
3. Mọi thay đổi chính thức chiếu vào Conversation của đối tượng dưới dạng tin `system`.
4. `[S]` "Đã chốt": một Link `relation = resolution` từ tin nhắn tới đối tượng anchor. Đây là dấu ghim có nguồn, không phải dữ liệu chính thức; nếu điều đã chốt tương ứng một trường dữ liệu thì phải cập nhật trường đó (AD-18).

## 8. Lõi dùng chung và gói lĩnh vực

- Lõi: toàn bộ entity ở mục 3. Không có cột, bảng hay nhánh logic nào mang nghĩa nhà thờ.
- Gói nhà thờ là dữ liệu cấu hình: bộ `EventTemplate`, danh mục tên Position, loại `EventItem` `[S]`, nhãn hiển thị.
- Kiểm tra: đổi gói cấu hình phải đủ để dùng cho một đội sự kiện mà không sửa schema.

## 9. Khác biệt so với báo cáo Discovery

| Điểm | Báo cáo trước | Đặc tả này | Lý do |
| --- | --- | --- | --- |
| Người theo dõi | Vai trò trên Event/Task | `Subscription` | Tránh hai cơ chế cùng nghĩa; đúng phân biệt Audience/Subscription (AD-05) |
| Mức "Tóm tắt" | Một mức thông báo | Không vật chất hoá thành Notification | Tránh ghi N dòng cho N thành viên chung (AD-06) |
| Dời lịch → xác nhận lại | Should | MVP | Là lõi của "trách nhiệm không mất khi kế hoạch đổi" (AD-22) |
| Trả lời hộ | Không có | Có | Thực tế có người không dùng app (AD-15) |
| Conversation tham chiếu anchor | Chưa nêu | Đa hình `(type, id)` | Giữ Messaging độc lập với module khác (AD-04) |
