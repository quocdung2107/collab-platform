# NOTIFICATION_ENGINE

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: `PRODUCT_MODEL.md`, `EVENT_API_CONTRACTS.md`, `PERMISSION_MODEL.md`, `DATA_MODEL.md`

## 1. Ba khái niệm phải tách

| Khái niệm | Câu hỏi | Do ai quyết định | Lưu ở đâu |
| --- | --- | --- | --- |
| **Audience** | Ai liên quan tới sự kiện này vì trách nhiệm hoặc vì được nhắc tới? | Cấu trúc dữ liệu (vai trò trên đối tượng) | Suy ra từ `assignments`, `event_owners`, `tasks`, `task_collaborators`, `message_mentions`, `group_members` |
| **Subscription** | Ngoài trách nhiệm, tôi muốn theo dõi hay tắt tiếng cái gì? | Người dùng | `subscriptions` |
| **Preference** | Thông báo tới tôi bằng kênh nào, lúc nào? | Người dùng | `notification_preferences` |

Audience quyết định **có nhận hay không và ở lớp nào**. Subscription chỉ nâng hoặc hạ phần không thuộc trách nhiệm. Preference chỉ ảnh hưởng **kênh đẩy**, không bao giờ làm mất bản ghi.

## 2. Hai mặt phẳng thông báo

| | Thông báo công việc | Tin nhắn chat |
| --- | --- | --- |
| Nguồn | ActivityEvent của Event, Assignment, Task, thành viên; và mention | `message.created` |
| Bản ghi | `notifications` (hộp thông báo) | Không có; số chưa đọc tính từ `conversation_states.last_read_seq` |
| Đẩy | Theo lớp và Preference | Theo chế độ của hội thoại (mục 9) |

Mention và trả lời trực tiếp là cầu nối: sinh từ chat nhưng tạo bản ghi trong hộp thông báo.

## 3. Lớp ưu tiên

| Lớp | Nhãn | Vật chất hoá | Đặc tính |
| --- | --- | --- | --- |
| `action_required` | Cần bạn | Có | Bắt buộc. Không tắt được, không bị `mute`. Giữ `action_state = pending` tới khi hành động xảy ra hoặc bị thay thế. Người giao thấy trạng thái chưa xử lý |
| `direct` | Nên biết | Có | Liên quan trực tiếp, không cần hành động. Đẩy theo Preference |
| `ambient` | Tóm tắt | **Không** | Chỉ là dòng hệ thống trong Conversation liên quan và là dữ liệu cho bản tóm tắt `[S]`. Không đẩy, không có bản ghi theo người (AD-06) |

**Bắt buộc ≠ bắt buộc đẩy** (AD-07). "Bắt buộc" gồm đúng ba bảo đảm:

1. Có bản ghi `notifications` lớp `action_required`.
2. Mục tương ứng nằm trong My Workspace › Cần phản hồi (đọc trực tiếp từ dữ liệu nghiệp vụ, không phụ thuộc bản ghi thông báo).
3. Người giao/người quản lý thấy trạng thái chờ trên đối tượng.

Thông báo đẩy cho lớp này bật mặc định, người dùng tắt được (trong app hoặc ở hệ điều hành). Khi tắt, ba bảo đảm trên vẫn nguyên.

## 4. Đường ống xử lý

```
ActivityEvent (outbox)
  → [1] Chọn quy tắc theo verb (ma trận mục 5)
  → [2] Xác định Audience  → tập (user, lớp, lý do)
  → [3] Loại actor; lọc quyền xem đối tượng đích
  → [4] Áp Subscription (follow nâng, mute hạ; không đụng lý do trách nhiệm)
  → [5] Khử trùng + gộp theo nguyên nhân gốc → upsert notifications
  → [6] Gộp theo thời gian (coalescing)
  → [7] Lập lịch delivery: Preference, giờ yên lặng, debounce
  → [8] Gửi; thử lại; ghi kết quả
  → phát realtime `notification.created` / `notification.updated` tới client
```

Bước 2 dùng **định danh trong payload** cho người nhận đích danh (ví dụ `assignee_id`, `to_owner_id`) và **trạng thái hiện tại** cho tập thể (người phụ trách Event, người theo dõi). Bước 8 kiểm tra lại quyền xem và tính còn hiệu lực ngay trước khi gửi.

## 5. Ma trận người nhận

Ký hiệu vai trò:

- `assignee`: người của Assignment trong payload.
- `active_assignees`: người có Assignment `requested`/`accepted`/`reconfirm` trên Event.
- `event_owners`: người trong `event_owners`.
- `position_managers`: `event_owners` ∪ trưởng nhóm của `positions.group_id`.
- `task_owner`, `assigned_by`, `collaborators`: theo Task.
- `subscribers`: người có Subscription `follow` trên đối tượng.
- `scope`: dòng hệ thống trong Conversation của đối tượng, **nếu Conversation đó đã tồn tại** (Task chưa có tin nhắn nào thì chỉ có lịch sử, không có dòng hệ thống); với các verb của Event đánh dấu (†) còn chiếu vào Conversation của các Group trong `event_groups`.

Actor không bao giờ nhận thông báo về hành động của chính mình. Ô trống = không ai.

| Verb | `action_required` | `direct` | `ambient` |
| --- | --- | --- | --- |
| `member.joined` | | | Conversation các nhóm họ được thêm vào |
| `member.removed` | | | |
| `member.role_changed` | | người được đổi vai trò | |
| `group.member_added` | | người được thêm | scope |
| `group.member_removed` | | người bị gỡ | scope |
| `group.member_role_changed` | | người được đổi vai trò | scope |
| `event.published` † | (qua `assignment.requested` con) | `event_owners` | scope |
| `event.updated` | | `event_owners`, `subscribers`; thêm `active_assignees` nếu lệnh có `notify_assignees = true` | scope |
| `event.rescheduled` † | (qua `assignment.reconfirm_requested` con) | Người có Assignment `accepted` không phải xác nhận lại, `event_owners`, `subscribers`; `task_owner` của Task có hạn bị dời (qua `task.due_changed` con). Người đang có bản ghi chờ trên Event: áp quy tắc làm mới (§8.2) | scope |
| `event.relocated` † | | `active_assignees`, `event_owners`, `subscribers` | scope |
| `event.cancelled` † | | `active_assignees` (trước khi huỷ), `event_owners`, `subscribers`; `task_owner` của mọi Task chưa xong thuộc Event (kể cả Task được giữ lại); `collaborators` của Task bị huỷ theo | scope |
| `event.owner_changed` | | người được thêm/gỡ | scope |
| `position.created` / `position.updated` / `position.removed` | | | scope |
| `assignment.requested` | `assignee` — hành động: Nhận/Từ chối | | scope |
| `assignment.accepted` | | `assignee` nếu được trả lời hộ | scope |
| `assignment.declined` | `position_managers` — hành động: lấp vị trí | `assignee` nếu được trả lời hộ | scope |
| `assignment.reconfirm_requested` | `assignee` — hành động: Nhận/Từ chối | | scope |
| `assignment.cancelled` (`removed`, `replaced`, `position_removed`) | | `assignee` | scope |
| `assignment.cancelled` (`event_cancelled`) | | (gộp vào `event.cancelled`) | |
| `assignment.cancelled` (`member_left`) | `position_managers` — hành động: lấp vị trí | | scope |
| `task.created` (chưa có owner) | | | scope |
| `task.assigned` | `to_owner` — hành động: Nhận/Từ chối nếu `requires_acceptance`, nếu không: mở xem | `from_owner` ("bạn không còn phụ trách") | scope |
| `task.assigned` (`to_owner_id` rỗng, do hệ thống khi owner rời tổ chức) | `assigned_by` — hành động: giao lại. Nếu `assigned_by` không còn là thành viên: người quản lý phạm vi của Task | | scope |
| `task.accepted` | | `assigned_by` | scope |
| `task.declined` | `assigned_by` — hành động: giao lại | | scope |
| `task.status_changed` | | `subscribers` | scope |
| `task.completed` | | `assigned_by`, `collaborators`, `subscribers` | scope |
| `task.reopened` | | `task_owner`, `subscribers` | scope |
| `task.cancelled` | | `task_owner`, `collaborators`, `subscribers` | scope |
| `task.due_changed` | | `task_owner`, `subscribers` | scope |
| `task.updated` | | `subscribers` | scope |
| `task.flag_changed` (bật) | | `assigned_by`; `event_owners` nếu Task thuộc Event; thêm `collaborators` nếu là `needs_help` | scope |
| `task.flag_changed` (tắt) | | | scope |
| `task.collaborator_added` / `task.collaborator_removed` | | người được thêm/gỡ | scope |
| `message.created` | | người được mention; người có tin nhắn được trả lời | (chat: mục 9) |
| `message.edited` | | người **mới** được mention | |
| `message.deleted` | | (thu hồi thông báo mention của tin đó) | |
| `context.linked` / `context.unlinked` | | | scope của đối tượng đích |
| `attachment.added` / `attachment.removed` (trên Event/Task) | | `subscribers` | scope |
| `[S]` `reminder.fired` (`response_pending`) | | `assignee` / `task_owner` (đẩy lại, không tạo mục mới) | |
| `[S]` `reminder.fired` (`event_soon`, `due_soon`) | | `assignee` đã nhận / `task_owner` | |
| `[S]` `escalation.raised` | | `position_managers` / `assigned_by` | |
| `[S]` `task.overdue` | | `task_owner` | |

Kiểm tra đầy đủ: mọi verb trong danh mục của `EVENT_API_CONTRACTS.md` §2 đều có dòng ở bảng này, hoặc nằm trong danh sách "không thông báo" sau: `organization.created`, `organization.updated`, `member.invited`, `group.created`, `group.updated`, `group.archived`, `event.created`, `event.plan_changed`.

## 6. Subscription

| Đối tượng | Chế độ | Hiệu lực |
| --- | --- | --- |
| `event`, `task` | `follow` | Người dùng được tính vào `subscribers` của đối tượng |
| `event`, `task` | `mute` | Loại bỏ phần thông báo không thuộc trách nhiệm; xem quy tắc 2–3 bên dưới |
| `conversation` | `all` / `mentions` / `mute` | Điều khiển đẩy tin nhắn chat (mục 9) |

Quy tắc xác định:

1. Mỗi dòng audience mang một **lý do**. Lý do trách nhiệm: `assignee`, `position_manager`, `task_owner`, `assigned_by`, `collaborator`, `event_owner`, `target_user` (người bị tác động trực tiếp: được thêm, bị gỡ, được trả lời hộ). Lý do quan tâm: `subscriber`, `mentioned`, `replied`.
2. `mute` trên một đối tượng loại bỏ các dòng có lý do quan tâm `subscriber`, và **tắt đẩy** (không xoá bản ghi) cho `mentioned`/`replied` trong Conversation của đối tượng đó.
3. `mute` không ảnh hưởng dòng có lý do trách nhiệm, ở bất kỳ lớp nào.
4. `follow` đòi hỏi quyền xem đối tượng; mất quyền xem thì Subscription bị xoá.
5. Người khác có thể thêm bạn làm người theo dõi (`created_by ≠ user_id`); bạn tự bỏ được.
6. Mặc định khi tạo: không có Subscription nào. Người tạo Task tự động `follow` Task đó nếu họ không phải owner.

## 7. Notification Preference

| Cài đặt | Mặc định | Hiệu lực |
| --- | --- | --- |
| `push_action_required` | bật | Tắt: không đẩy lớp `action_required`; bản ghi và My Workspace giữ nguyên |
| `push_direct` | bật | Tắt: lớp `direct` chỉ nằm trong hộp thông báo |
| `quiet_hours_enabled`, `quiet_start`, `quiet_end` | OD-03 | Mục 8.3 |
| `[S]` `digest` | `off` | `daily` / `weekly`: tổng hợp `ambient` |

Preference áp theo người dùng, dùng chung cho mọi Organization họ tham gia (MVP).

## 8. Quy tắc xử lý

### 8.1 Khử trùng (Deduplication)

- Khoá: `(user_id, root_activity_id)`, với `root_activity_id = cause_id` nếu có, ngược lại là `id` của chính ActivityEvent. `cause_id` luôn trỏ thẳng về gốc (không lồng nhiều tầng).
- Ràng buộc UNIQUE trên khoá này. Một người, một nguyên nhân gốc → đúng một bản ghi, bất kể họ có bao nhiêu vai trò hay bao nhiêu sự kiện con.
- Khi nhiều dòng audience cùng rơi vào một khoá: lớp = lớp cao nhất; `reasons` = hợp các lý do; mỗi sự kiện con là một dòng `notification_items`.
- Xử lý lại cùng một ActivityEvent (giao lại từ outbox) là idempotent nhờ ràng buộc trên và nhờ khoá chính `(notification_id, activity_event_id)` của `notification_items`.

### 8.2 Gộp (Aggregation)

Ba cơ chế, theo thứ tự:

1. **Theo nguyên nhân** (đã có ở 8.1): `event.rescheduled` làm 1 Assignment phải xác nhận lại và 2 Task dời hạn → một bản ghi "Buổi X dời sang …; 1 vị trí cần xác nhận lại, 2 việc đổi hạn".
2. **Theo thời gian** (coalescing): nếu một nguyên nhân gốc mới thuộc cùng `family` trên cùng đối tượng gốc tới trong vòng `COALESCE_WINDOW` kể từ bản ghi trước của cùng người, và bản ghi trước **chưa đọc**: không tạo bản ghi mới; cập nhật bản ghi cũ (thêm `items`, đặt lại `updated_at`, lớp = lớp cao nhất). Delivery chưa gửi được thay nội dung; delivery đã gửi thì gửi bản thay thế với cùng khoá thu gọn của kênh đẩy.

3. **Làm mới bản ghi đang chờ**: nếu một sự kiện thuộc family `event.change` lẽ ra tạo bản ghi `direct` cho một người đang có bản ghi `action_required` còn `pending` trên một Assignment của cùng Event, thì **không tạo bản ghi mới**; sự kiện được đính thành một `notification_items` của bản ghi đang chờ, `updated_at` được đặt lại và thông báo đẩy được gửi dạng thay thế. Vì câu tóm tắt dựng khi xem, bản ghi đang chờ tự hiển thị giờ/địa điểm mới. Quy tắc này áp dụng bất kể `COALESCE_WINDOW`.

`family`:

| Family | Verb |
| --- | --- |
| `event.change` | `event.updated`, `event.rescheduled`, `event.relocated` |
| `assignment.request` | `assignment.requested`, `assignment.reconfirm_requested` (cùng Event) |
| `task.change` | `task.updated`, `task.due_changed`, `task.status_changed`, `task.flag_changed` |
| (không gộp thời gian) | mọi verb còn lại |

### 8.3 Giờ yên lặng (Quiet Hours)

- Tính theo múi giờ của người dùng.
- Trong giờ yên lặng: bản ghi vẫn tạo ngay; delivery đẩy đặt `not_before = quiet_end`.
- Khi hết giờ yên lặng: mọi delivery bị hoãn của một người gửi thành **một** thông báo đẩy tổng hợp ("3 việc cần bạn, 5 cập nhật").
- Ngoại lệ vượt giờ yên lặng: OD-03. Mặc định đề xuất: lớp `action_required` mà Event liên quan bắt đầu trước `quiet_end + 2 giờ` thì gửi ngay.

### 8.4 Đổi người (Reassignment)

Áp dụng cho `task.assigned` có `from_owner`, và `assignment.cancelled` với `replaced`/`removed`:

1. Mọi Notification `action_required` còn `pending` của người cũ trên đối tượng đó → `action_state = superseded`.
2. Mọi delivery chưa gửi của các bản ghi đó → `cancelled`.
3. `[S]` Mọi nhắc việc đã lên lịch cho người cũ trên đối tượng đó → huỷ.
4. Người cũ nhận đúng một bản ghi `direct`.
5. Người mới nhận `action_required` như một yêu cầu mới.
6. Người cũ mất Subscription tự động nếu mất quyền xem.

### 8.5 Dời lịch (Event Rescheduling)

Lệnh dời lịch phát `event.rescheduled` (gốc) và, trong cùng giao dịch, các sự kiện con mang `cause_id` = gốc:

| Đối tượng | Điều kiện | Hệ quả | Sự kiện con |
| --- | --- | --- | --- |
| Assignment `accepted` | Độ dời ≥ `RECONFIRM_THRESHOLD` | → `reconfirm` | `assignment.reconfirm_requested` |
| Assignment `accepted` | Độ dời < ngưỡng | Giữ nguyên | — (nhận `direct` từ gốc) |
| Assignment `requested` | Bất kỳ | Giữ nguyên; bản ghi `action_required` đang chờ được làm mới (§8.2, cơ chế 3), không có bản ghi thứ hai | — |
| Assignment `reconfirm` | Bất kỳ | Giữ nguyên; bản ghi đang chờ được làm mới | — |
| Task có `due_offset_min` | Bất kỳ | `due_at` tính lại | `task.due_changed` |
| Task có `due_at` tuyệt đối | Bất kỳ | Không đổi; liệt kê trong màn hình xác nhận cho người điều phối | — |

Nhờ 8.1, mỗi người nhận đúng một bản ghi cho một lần dời lịch.

Đổi địa điểm (`event.relocated`) không yêu cầu xác nhận lại.

### 8.6 Gửi và thử lại (Delivery Retry)

- Bản ghi trong hộp thông báo là nguồn sự thật; kênh đẩy là nỗ lực tốt nhất.
- Mỗi thiết bị một delivery. Trạng thái: `scheduled → sent` | `failed` | `cancelled` | `skipped`.
- Debounce trước khi gửi: `DEBOUNCE_ACTION` cho `action_required`, `DEBOUNCE_DIRECT` cho `direct`, để coalescing kịp gộp.
- Lỗi tạm thời: thử lại theo `RETRY_SCHEDULE`, tối đa `RETRY_MAX` lần, sau đó `failed`.
- Lỗi vĩnh viễn (token không hợp lệ): `failed`, vô hiệu hoá `device_tokens` tương ứng, không thử lại.
- Trước mỗi lần gửi: bỏ qua (`skipped`) nếu bản ghi đã đọc, đã `superseded`/`done`, hoặc người nhận mất quyền xem.
- Nội dung đẩy dựng tại thời điểm gửi, chỉ chứa tóm tắt tối thiểu.
- Thất bại kênh đẩy không tạo ActivityEvent; ghi vào `notification_deliveries.last_error` để vận hành theo dõi.

### 8.7 Trạng thái đọc và hành động (Read / Action Status)

Hai trục độc lập:

| Trục | Giá trị | Chuyển đổi |
| --- | --- | --- |
| `read_at` | null / thời điểm | Đặt khi người dùng mở mục, mở đối tượng đích, hoặc "đánh dấu tất cả đã đọc" (chỉ áp cho lớp `direct`) |
| `action_state` | `none`, `pending`, `done`, `superseded` | `direct` luôn `none`. `action_required` bắt đầu `pending` |

Sự kiện giải quyết `pending → done`:

| Bản ghi sinh từ | Được giải quyết bởi |
| --- | --- |
| `assignment.requested`, `assignment.reconfirm_requested` | `assignment.accepted` / `assignment.declined` của chính Assignment đó |
| `assignment.declined`, `assignment.cancelled` (`member_left`) → `position_managers` | Position đủ `slots` Assignment đang hiệu lực; áp cho **mọi** người quản lý cùng lúc |
| `task.assigned` (cần nhận) | `task.accepted` / `task.declined` |
| `task.assigned` (không cần nhận) | Người nhận mở Task (đặt `read_at` và `done` cùng lúc) |
| `task.declined` → `assigned_by` | `task.assigned` kế tiếp trên Task đó |

Bản ghi có nhiều `notification_items` cần hành động (ví dụ một thành viên rời tổ chức làm trống ba vị trí) chỉ chuyển `done` khi **mọi** mục cần hành động đã được giải quyết hoặc bị thay thế.

Chuyển `pending → superseded`: đối tượng bị huỷ (`event.cancelled`, `task.cancelled`, `assignment.cancelled`, `position.removed`), hoặc người nhận bị thay (8.4).

Trạng thái hành động là **hình chiếu** của dữ liệu nghiệp vụ. Nếu lệch, dữ liệu nghiệp vụ thắng; My Workspace không đọc từ `notifications`.

Người giao thấy gì: trên Assignment/Task có `seen_by_recipient` (suy ra từ `read_at` của bản ghi `action_required` tương ứng) và trạng thái phản hồi.

## 9. Đẩy tin nhắn chat

| Chế độ hội thoại | Tin thường | Mention / trả lời tôi |
| --- | --- | --- |
| `all` | Đẩy | Đẩy + hộp thông báo |
| `mentions` | Không đẩy | Đẩy + hộp thông báo |
| `mute` | Không đẩy | Không đẩy; vẫn vào hộp thông báo |

Mặc định khi chưa có Subscription cho hội thoại:

| Hội thoại | Người dùng | Mặc định |
| --- | --- | --- |
| Group | Thành viên nhóm | `all` |
| Event / Task | Người có lý do trách nhiệm trên đối tượng | `all` |
| Event / Task | Người khác xem được | `mentions` |

- Đẩy chat thu gọn theo hội thoại: nhiều tin liên tiếp → một thông báo đẩy được cập nhật.
- Không đẩy nếu người dùng đang mở hội thoại đó.
- Tôn trọng giờ yên lặng, không có ngoại lệ.
- Tin `system` không bao giờ đẩy qua mặt phẳng chat.

## 10. `[S]` Nhắc việc, leo thang, tóm tắt

| Cơ chế | Quy tắc |
| --- | --- |
| Nhắc phản hồi | `REMIND_AFTER` sau khi yêu cầu, nếu còn `pending`: đẩy lại cùng bản ghi (`reminder.fired`) |
| Leo thang | `ESCALATE_AFTER` sau khi yêu cầu, hoặc `ESCALATE_BEFORE_EVENT` trước giờ bắt đầu, tuỳ cái nào tới trước, nếu còn `pending`: `escalation.raised` tới người giao/người quản lý vị trí. Chỉ một lần. Không leo thang tới nhóm |
| Nhắc trước buổi | `EVENT_REMINDER_BEFORE` trước giờ có mặt, cho Assignment `accepted` |
| Quá hạn | Một lần tại `due_at` (`task.overdue`) |
| Tóm tắt | Tổng hợp `ambient` người dùng được phép xem trong kỳ |

Phụ thuộc bảng `scheduled_jobs`. MVP không có các cơ chế này; thay vào đó người điều phối thấy trạng thái chờ trên Event và My Workspace.

## 11. Tham số

| Tham số | Mặc định đề xuất | Trạng thái |
| --- | --- | --- |
| `RECONFIRM_THRESHOLD` | Đổi ngày, hoặc dời ≥ 30 phút | OD-02 |
| `COALESCE_WINDOW` | 10 phút | Điều chỉnh sau khi đo |
| `DEBOUNCE_ACTION` | 30 giây | Điều chỉnh sau khi đo |
| `DEBOUNCE_DIRECT` | 120 giây | Điều chỉnh sau khi đo |
| `RETRY_SCHEDULE`, `RETRY_MAX` | 1, 5, 30 phút; 3 lần | Điều chỉnh sau khi đo |
| Giờ yên lặng mặc định | 22:00–06:30, bật | OD-03 |
| `REMIND_AFTER`, `ESCALATE_AFTER`, `ESCALATE_BEFORE_EVENT`, `EVENT_REMINDER_BEFORE` | 24 giờ, 48 giờ, 24 giờ, 24 giờ | `[S]`, chốt sau Phase 0 |

Các giá trị này là điểm khởi đầu hợp lý, chưa có dữ liệu thực nghiệm đứng sau.

## 12. Bất biến để kiểm thử

- N1. Actor không nhận thông báo về hành động của chính mình.
- N2. Một người nhận tối đa một bản ghi cho một nguyên nhân gốc.
- N3. Không tồn tại bản ghi cho người không có quyền xem đối tượng đích tại thời điểm tạo.
- N4. `mute` không bao giờ loại bỏ bản ghi có lý do trách nhiệm.
- N5. Tắt mọi kênh đẩy không làm mất bản ghi nào và không làm mất mục nào trong My Workspace.
- N6. Sau khi đổi người, người cũ không còn bản ghi `pending` nào trên đối tượng và không nhận thêm thông báo đẩy về nó, trừ đúng một bản ghi `direct`.
- N7. Mọi bản ghi `action_required` kết thúc ở `done` hoặc `superseded`; không có đường nào để nó "treo" khi đối tượng đã ở trạng thái cuối.
- N8. Xử lý lại một ActivityEvent không tạo thêm bản ghi hay delivery.
- N9. Không có thông báo đẩy nào được gửi trong giờ yên lặng, trừ ngoại lệ đã định nghĩa.
- N10. Thành viên chung của nhóm (không vai trò, không Subscription) không nhận bản ghi nào và không bị đẩy khi Event thay đổi.

## Phụ lục: Kênh đẩy trên PWA (AD-25, OD-17)

- Kênh đẩy là Web Push. Trên iPhone/iPad, Web Push chỉ hoạt động khi ứng dụng đã được thêm vào Màn hình chính; trong tab Safari thường không nhận được. Do đó `push_subscriptions.installed_standalone` được ghi, và ứng dụng hiển thị hướng dẫn cài đặt khi chạy ngoài chế độ standalone.
- Hệ quả cho AD-07: không đổi. "Bắt buộc" không dựa vào đẩy. Người chưa cài vẫn có bản ghi `action_required` trong Việc của tôi và người giao thấy trạng thái chờ. Đề xuất bổ sung email cho lớp `action_required` (OD-17).
- Lớp `ambient` không bao giờ đẩy ngoài chế độ `mentions`/`all` do người dùng chọn.
- Đẩy không được coi là đã giao nếu dịch vụ đẩy trả lỗi `410/404`: xoá subscription và ghi `delivery_failed`.
- Thông báo dựng nội dung khi gửi, sau `can()` (AD-10); nội dung đẩy ngắn, không chứa dữ liệu nhạy cảm.
