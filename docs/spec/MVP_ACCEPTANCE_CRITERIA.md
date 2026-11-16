# MVP_ACCEPTANCE_CRITERIA

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: toàn bộ các tài liệu khác trong bộ.

Chỉ gồm chức năng `[MVP]`. Chức năng `[S]`/`[EXT]` không có tiêu chí ở đây và MVP không được phụ thuộc vào chúng.

## 0. Phạm vi MVP

| Mã | Chức năng |
| --- | --- |
| F1 | Tổ chức, lời mời, thành viên |
| F2 | Nhóm |
| F3 | Event: tạo từ mẫu/sao chép/trống, sửa, publish |
| F4 | Position và xếp người |
| F5 | Trả lời phân công (kể cả trả lời hộ) |
| F6 | Gỡ và thay người |
| F7 | Dời lịch, đổi địa điểm, huỷ Event |
| F8 | Task: tạo, giao, nhận/từ chối, tiến độ, cờ |
| F9 | Hội thoại: nhóm và thread; tin nhắn, trả lời, mention, tệp |
| F10 | Liên kết: tạo Task từ tin nhắn, thẻ đối tượng, khối Liên quan |
| F11 | Thông báo: hộp thông báo, lớp, khử trùng, gộp, Subscription, Preference, giờ yên lặng, đẩy và thử lại |
| F12 | My Workspace |
| F13 | Lịch sử đối tượng |
| F14 | Phân quyền và truy cập chéo |

Ngoài MVP (ngày bận tối thiểu đã làm ở AD-34): tìm kiếm toàn văn, xem trước chi tiết khi dời lịch, nhắc việc và leo thang, tóm tắt, đề xuất người thay, "đã chốt", dòng chương trình, tích hợp Koinonia, DM, AI.

Ký hiệu nhân vật: **AD** org admin · **LD** trưởng nhóm Âm thanh · **OW** người phụ trách Event · **M1, M2, M3** thành viên · **X** thành viên tổ chức không thuộc nhóm nào.

## F1. Tổ chức, lời mời, thành viên

| | |
| --- | --- |
| Đầu vào | Người dùng đã đăng nhập (OD-08) |
| Hành vi | Tạo tổ chức → người tạo là `owner`. AD tạo liên kết mời có hạn, tuỳ chọn kèm nhóm. Người mở liên kết hợp lệ trở thành `member` và được thêm vào nhóm kèm theo |
| Kết quả | Membership `active`; `member.joined`; My Workspace của người mới hiển thị đúng dữ liệu hiện có |
| Lỗi | Liên kết hết hạn/thu hồi/hết lượt → thông báo rõ, không tạo Membership. Đã là thành viên → vào thẳng, không tạo trùng |
| Quyền | Tạo/thu hồi lời mời, gỡ thành viên: AD. Chuyển `owner`: `owner` |

Kiểm thử:

- F1-T1. Mở liên kết hợp lệ hai lần bởi cùng người → một Membership.
- F1-T2. Liên kết có `max_uses = 1`, hai người mở gần như đồng thời → đúng một người thành công.
- F1-T3. Gỡ `owner` cuối cùng → bị từ chối.
- F1-T4. Gỡ M1 đang có 2 Assignment `accepted` ở hai Event tương lai do cùng OW phụ trách → cả hai `cancelled` (`member_left`); OW nhận **một** bản ghi "Cần bạn" (cùng nguyên nhân gốc `member.removed`) gồm hai mục; bản ghi chỉ `done` khi cả hai vị trí được lấp; M1 không còn truy cập được gì.
- F1-T5. Gỡ M1 đang là owner của Task chưa xong → `task.assigned` với `to_owner_id` rỗng; người giao nhận "Cần bạn".

## F2. Nhóm

| | |
| --- | --- |
| Đầu vào | AD đã đăng nhập |
| Hành vi | Tạo nhóm → tạo Conversation của nhóm. Thêm/gỡ thành viên, đặt `leader` |
| Kết quả | Thành viên mới đọc/ghi được hội thoại nhóm ngay; người bị gỡ mất quyền ngay |
| Lỗi | Trùng tên nhóm đang hoạt động → `validation_failed` |
| Quyền | Tạo: AD. Quản lý thành viên: AD, `leader` |

Kiểm thử:

- F2-T1. X (không thuộc nhóm) gọi đọc hội thoại nhóm → `not_found`.
- F2-T2. AD không thuộc nhóm gọi đọc hội thoại nhóm → `not_found`. AD tự thêm mình → dòng hệ thống xuất hiện trong hội thoại.
- F2-T3. M1 bị gỡ khi đang mở hội thoại → client nhận tín hiệu `access_changed` trên kênh `user:{id}` (AD-31), làm mới phiên và hội thoại đóng.
- F2-T4. Thành viên mới thấy lịch sử hội thoại nhóm (mặc định MVP theo OD-16).

## F3. Event

| | |
| --- | --- |
| Đầu vào | AD hoặc `leader` (Event gồm nhóm của họ) |
| Hành vi | Tạo bản nháp trống, từ mẫu (sinh Position và Task mẫu), hoặc sao chép Event trước (Position, Task; **không** sao chép Assignment trừ khi chọn "giữ nguyên người"). Sửa bản nháp không báo ai. Publish gửi yêu cầu |
| Kết quả | `event.published`; Conversation của Event được tạo; mọi Assignment `draft` → `requested` |
| Lỗi | `ends_at ≤ starts_at` → `validation_failed`. Publish lần hai → `invalid_transition`. Sửa với `expected_version` cũ → `version_conflict` |
| Quyền | `PERMISSION_MODEL.md` §4.4 |

Kiểm thử:

- F3-T1. Bản nháp: M1 được xếp nhưng chưa publish → M1 không thấy Event, không có thông báo, My Workspace không đổi.
- F3-T2. Publish Event có 5 Assignment → đúng 5 `assignment.requested` cùng `cause_id`; mỗi người một thông báo.
- F3-T3. Một người được xếp 2 vị trí trong cùng Event → **một** thông báo liệt kê 2 vị trí.
- F3-T4. Thành viên chung của nhóm liên quan (không được xếp) → không có bản ghi thông báo, không bị đẩy; chỉ thấy dòng hệ thống trong hội thoại nhóm.
- F3-T5. Hai người điều phối cùng sửa tiêu đề → người lưu sau nhận `version_conflict` kèm bản mới.
- F3-T6. Tạo từ mẫu tham chiếu nhóm đã lưu trữ → Event vẫn được tạo, phần đó bị bỏ qua và được báo.

## F4. Position và xếp người

| | |
| --- | --- |
| Đầu vào | Event `draft` hoặc `published`; người gọi là `position_manager` |
| Hành vi | Thêm Position (`slots`, nhóm phụ trách, giờ có mặt). Xếp thành viên `active` vào Position |
| Kết quả | Event `published`: Assignment `requested` + thông báo "Cần bạn" cho người được xếp |
| Lỗi | `position_full`, `duplicate_assignment`, `not_a_member` |
| Quyền | `leader` chỉ quản lý Position có `group_id` là nhóm của mình |

Kiểm thử:

- F4-T1. `slots = 1`; OW và LD xếp hai người khác nhau gần như đồng thời → đúng một Assignment được tạo, người kia nhận `position_full`.
- F4-T2. Xếp cùng một người hai lần vào cùng Position → `duplicate_assignment`.
- F4-T3. Xếp một người đang có Assignment hiệu lực ở Event trùng giờ → thành công kèm `warnings[overlapping_assignment]`.
- F4-T4. LD cố sửa Position của nhóm khác → `forbidden`.
- F4-T5. Xếp X (không thuộc nhóm nào) → thành công; X thấy Event và thread, không thấy hội thoại nhóm Âm thanh.

## F5. Trả lời phân công

| | |
| --- | --- |
| Đầu vào | Assignment ở `requested` hoặc `reconfirm` (nhận/từ chối), hoặc `accepted` (từ chối) |
| Hành vi | Người được xếp Nhận hoặc Từ chối (bắt buộc lý do). `position_manager` trả lời hộ được |
| Kết quả | Trạng thái mới; `responded_by` ghi lại; bản ghi "Cần bạn" của người được xếp → `done`. Từ chối: `position_managers` nhận "Cần bạn: lấp vị trí" |
| Lỗi | Từ chối thiếu lý do → `validation_failed`. Assignment đã `cancelled` → `state_conflict`. Người khác trả lời → `forbidden`/`not_found` |
| Quyền | `PERMISSION_MODEL.md` §4.5 |

Kiểm thử:

- F5-T1. Nhận từ thông báo đẩy, từ My Workspace, từ thẻ trong chat → cùng kết quả, cùng một sự kiện.
- F5-T2. Bấm Nhận hai lần (mạng chậm) → một `assignment.accepted`.
- F5-T3. M1 bấm Nhận trong khi OW vừa gỡ M1 → M1 nhận `state_conflict`, giao diện hiện "Bạn đã được gỡ khỏi vị trí này".
- F5-T4. M1 từ chối → OW và LD (trưởng nhóm của Position) mỗi người một bản ghi "Cần bạn". OW xếp M2 đủ `slots` → bản ghi của **cả** OW và LD chuyển `done`.
- F5-T5. Lý do từ chối: OW, LD, M1 thấy; M2 xem Event không thấy; không xuất hiện trong lịch sử với M2.
- F5-T6. OW trả lời hộ M1 → giao diện ghi "OW xác nhận thay"; M1 nhận "Nên biết".
- F5-T7. M1 đã `declined` cố Nhận lại → `state_conflict`.

## F6. Gỡ và thay người

| | |
| --- | --- |
| Đầu vào | Assignment đang hiệu lực; người gọi là `position_manager` |
| Hành vi | Gỡ: `cancelled` (`removed`). Thay: cũ `cancelled` (`replaced`) + mới `requested`, một giao dịch |
| Kết quả | Người cũ nhận đúng một "Nên biết"; người mới nhận "Cần bạn" |
| Lỗi | `state_conflict`, `duplicate_assignment`, `not_a_member` |
| Quyền | `position_manager` |

Kiểm thử (người nhận bị thay thế):

- F6-T1. M1 đang `requested`, chưa đọc; OW thay bằng M2 → bản ghi "Cần bạn" của M1 → `superseded`; delivery chưa gửi của M1 → `cancelled`; M1 có một bản ghi "Nên biết"; M2 có một "Cần bạn".
- F6-T2. Như F6-T1 nhưng thông báo đẩy cho M1 đang trong debounce → M1 **không** nhận thông báo đẩy "Cần bạn"; chỉ nhận thông báo "Nên biết".
- F6-T3. Thay M1 bằng M2 thất bại vì M2 đã ở vị trí đó → Assignment của M1 giữ nguyên (giao dịch huỷ toàn bộ), không sự kiện nào được ghi.
- F6-T4. Event `visibility = groups`, X bị gỡ → X mất quyền xem Event; mở thông báo cũ thấy "Nội dung không còn khả dụng"; Subscription của X trên Event bị xoá.
- F6-T5. Sau khi bị thay, My Workspace của M1 không còn mục đó.

## F7. Dời lịch, đổi địa điểm, huỷ

| | |
| --- | --- |
| Đầu vào | Event `published`; người gọi có quyền sửa |
| Hành vi | Dời lịch áp bảng `NOTIFICATION_ENGINE.md` §8.5. Đổi địa điểm: chỉ thông báo. Huỷ: Assignment đang hiệu lực → `cancelled` (`event_cancelled`); Task `open` → `cancelled`; Task `in_progress`/`done` giữ nguyên; Conversation → chỉ-đọc |
| Kết quả | Một sự kiện gốc + các sự kiện con; mỗi người bị ảnh hưởng nhận đúng một bản ghi |
| Lỗi | `version_conflict`, `invalid_transition` (Event `draft`/`cancelled`), `validation_failed` |
| Quyền | Org admin, `event_owner` |

Kiểm thử (thay đổi lịch trình):

- F7-T1. Dời 2 giờ (≥ ngưỡng). M1 `accepted` → `reconfirm`, một "Cần bạn" nêu giờ cũ → mới. M2 `requested` → vẫn `requested`, bản ghi đang chờ được cập nhật giờ mới, không có bản ghi thứ hai.
- F7-T2. Dời 10 phút (< ngưỡng) → M1 vẫn `accepted`, nhận "Nên biết".
- F7-T3. M1 vừa có Assignment `accepted`, vừa là owner của Task có `due_offset_min`, vừa `follow` Event → **một** bản ghi, lớp `action_required`, `items` gồm cả ba hệ quả.
- F7-T4. Task có `due_offset_min = -2880` → `due_at` mới = `starts_at` mới − 2 ngày; `task.due_changed` có `by_reschedule = true`.
- F7-T5. Task có `due_at` tuyệt đối → không đổi; xuất hiện trong `summary.tasks_absolute_due`.
- F7-T6. Dời lịch ba lần trong 5 phút → mỗi người vẫn một bản ghi (gộp theo thời gian), hiển thị giờ cuối cùng; tối đa một thông báo đẩy mới cộng các lần thay thế nội dung.
- F7-T7. M1 xác nhận lại → `accepted`; từ chối → `position_managers` nhận "Cần bạn".
- F7-T8. Huỷ Event → mọi bản ghi `pending` liên quan → `superseded`; người được xếp nhận một "Nên biết"; My Workspace của họ không còn mục đó; thread chỉ-đọc.
- F7-T9. OW dời lịch trong khi AD huỷ Event → lệnh đến sau nhận `version_conflict` hoặc `invalid_transition`; không có trạng thái trộn.
- F7-T10. Thành viên chung của nhóm liên quan → không bản ghi, không đẩy; thấy dòng hệ thống trong hội thoại nhóm.

## F8. Task

| | |
| --- | --- |
| Đầu vào | Người tạo có quyền theo phạm vi |
| Hành vi | Tạo với phạm vi `event`/`group`/`private`; giao; nhận/từ chối khi `requires_acceptance`; đổi tiến độ; bật cờ; giao lại; huỷ; mở lại |
| Kết quả | Sự kiện và thông báo theo ma trận |
| Lỗi | `forbidden`, `not_a_member`, `version_conflict`, `invalid_transition` |
| Quyền | `PERMISSION_MODEL.md` §4.6 |

Kiểm thử:

- F8-T1. M1 (thành viên thường) tạo Task nhóm giao cho M2 → `requires_acceptance = true` dù M1 gửi `false`.
- F8-T2. LD tạo Task nhóm giao cho M2 không cần nhận → M2 có "Cần bạn"; chuyển `done` khi M2 mở Task.
- F8-T3. M2 từ chối → người giao nhận "Cần bạn: giao lại"; giao lại cho M3 → bản ghi đó `done`.
- F8-T4. Giao lại từ M2 sang M3 → M2: bản ghi cũ `superseded` + một "Nên biết"; M3: "Cần bạn".
- F8-T5. M2 bấm Xong trong khi LD giao lại cho M3 → lệnh đến sau nhận `version_conflict`; kết quả cuối nhất quán (hoặc `done` bởi M2, hoặc `open` với owner M3), không lai.
- F8-T6. `collaborator` cố đổi `status` → `forbidden`; bật cờ `needs_help` → thành công, người giao nhận "Nên biết".
- F8-T7. Task `private`: người ngoài danh sách tham gia → `not_found`.
- F8-T8. Tự giao cho chính mình → không có thông báo nào.

## F9. Hội thoại

| | |
| --- | --- |
| Đầu vào | Người dùng có `read(conversation)` |
| Hành vi | Gửi văn bản, ảnh/tệp, trả lời, mention; sửa/xoá tin của mình; đánh dấu đã đọc |
| Kết quả | Tin có `seq` tăng dần; người đang kết nối nhận ngay; số chưa đọc đúng |
| Lỗi | `read_only`; mention người không đọc được → `validation_failed` |
| Quyền | `PERMISSION_MODEL.md` §4.3 |

Kiểm thử:

- F9-T1. Gửi lại cùng `client_msg_id` → một tin.
- F9-T2. Hai người gửi đồng thời → `seq` khác nhau, thứ tự như nhau trên mọi client.
- F9-T3. Mention M1 trong nhóm M1 đã `mute` → có bản ghi "Nên biết", không đẩy.
- F9-T4. Hội thoại ở chế độ `mentions`: tin thường không đẩy; mention có đẩy.
- F9-T5. Xoá tin có mention chưa đọc → bản ghi tương ứng bị thu hồi; nội dung không còn truy xuất được qua API nào.
- F9-T6. Sửa tin, thêm mention M2 → chỉ M2 nhận thông báo mới.
- F9-T7. Gửi khi ngoại tuyến → tin xếp hàng, gửi khi có mạng, không trùng.
- F9-T8. Event bị huỷ → gửi tin vào thread nhận `read_only`.
- F9-T9. Dòng hệ thống: không sửa, không xoá, không đẩy.

## F10. Liên kết

| | |
| --- | --- |
| Đầu vào | Tin nhắn trong hội thoại người dùng ghi được |
| Hành vi | Tạo Task từ tin nhắn; chèn thẻ Event/Task vào tin nhắn; xem khối Liên quan trên Event/Task |
| Kết quả | Link `created_from` / `references`; thẻ Task hiện dưới tin gốc; truy xuất được cả hai chiều |
| Lỗi | Chèn thẻ đối tượng người gửi không xem được → `not_found` |
| Quyền | `CONTEXT_ENGINE.md` §5 |

Kiểm thử:

- F10-T1. Tạo Task từ tin nhắn nhóm → Task có `scope_type = group`; từ trang Task mở được tin gốc; dưới tin gốc có thẻ Task.
- F10-T2. Task đó giao cho X (ngoài nhóm) → X thấy Task, thấy "Tin nhắn gốc không khả dụng", không đọc được hội thoại nhóm bằng bất kỳ API nào.
- F10-T3. Tin nhắn nhóm chèn thẻ Event `visibility = groups` mà M3 không xem được → M3 thấy thẻ "Nội dung bị giới hạn", không tiêu đề.
- F10-T4. Trang Event › Liên quan: người xem thuộc nhóm A thấy tin nhắn nhắc tới từ nhóm A; không thấy tin từ nhóm B; số đếm mục ẩn đúng.
- F10-T5. Xoá tin gốc → Link `references` biến mất; Link `created_from` còn, Task hiện "Tin nhắn gốc không khả dụng".
- F10-T6. Chèn cùng một thẻ hai lần trong một tin → một Link.
- F10-T7. Sửa tin, bỏ thẻ → Link bị gỡ, `context.unlinked` được ghi.

## F11. Thông báo

| | |
| --- | --- |
| Đầu vào | ActivityEvent bất kỳ |
| Hành vi | Theo `NOTIFICATION_ENGINE.md` |
| Kết quả | Bản ghi đúng người, đúng lớp; đẩy đúng kênh, đúng lúc |
| Lỗi | Lỗi kênh đẩy không ảnh hưởng bản ghi |
| Quyền | Chỉ chủ bản ghi đọc được |

Kiểm thử (thông báo trùng và bất biến N1–N10):

- F11-T1 (N1). Actor không nhận thông báo về hành động của mình, trong mọi dòng của ma trận.
- F11-T2 (N2). OW vừa là `event_owner`, vừa được xếp vị trí, vừa `follow` → một bản ghi cho một lần dời lịch.
- F11-T3 (N8). Xử lý lại cùng một ActivityEvent 3 lần → số bản ghi và delivery không đổi.
- F11-T4 (N4). `mute` Event mình được xếp → vẫn nhận "Cần bạn" khi có yêu cầu xác nhận lại.
- F11-T5. `mute` Event mình chỉ `follow` → không nhận gì.
- F11-T6 (N5). Tắt cả hai công tắc đẩy → mọi bản ghi vẫn tạo; My Workspace đầy đủ; không delivery nào được gửi.
- F11-T7 (N9). Sự kiện xảy ra trong giờ yên lặng → bản ghi tạo ngay; đẩy sau `quiet_end`; nhiều bản ghi → một thông báo đẩy tổng hợp.
- F11-T8. Token thiết bị không hợp lệ → delivery `failed`, token bị vô hiệu hoá, không thử lại; thiết bị khác của cùng người vẫn nhận.
- F11-T9. Lỗi tạm thời của kênh đẩy → thử lại theo lịch; quá số lần → `failed`; bản ghi không đổi.
- F11-T10. Người dùng đọc bản ghi trong lúc delivery đang chờ → delivery `skipped`.
- F11-T11 (N3). Người mất quyền xem trước khi delivery gửi → `skipped`; mở bản ghi thấy "Nội dung không còn khả dụng".
- F11-T12 (N7). Với mỗi loại bản ghi `action_required`: tồn tại kịch bản đưa nó về `done` và kịch bản đưa về `superseded`; không kịch bản nào để lại `pending` khi đối tượng ở trạng thái cuối.
- F11-T13. "Đánh dấu tất cả đã đọc" không làm mất mục "Cần bạn" còn `pending`.
- F11-T14 (N10). Nhóm 100 người, Event có 10 người được xếp, dời lịch → đúng 10 người (cộng owner và người theo dõi) có bản ghi; 0 thông báo đẩy tới 90 người còn lại.
- F11-T15. Bộ `notifier` ngừng 10 phút rồi chạy lại → không mất, không trùng; bản ghi cho đối tượng đã huỷ trong thời gian đó không sinh delivery.

## F12. My Workspace

| | |
| --- | --- |
| Đầu vào | Người dùng đã đăng nhập, thuộc ≥ 1 tổ chức |
| Hành vi | Hiển thị ba khối (và khối Cần xử lý cho người điều phối) theo `UX_ARCHITECTURE.md` §4.1 |
| Kết quả | Dữ liệu đọc trực tiếp từ bảng nghiệp vụ |
| Lỗi | Mục không còn hiệu lực biến mất ở lần tải kế tiếp hoặc qua realtime |
| Quyền | Chỉ dữ liệu của chính mình |

Kiểm thử:

- F12-T1. Xoá toàn bộ bảng `notifications` (môi trường thử) → khối Cần phản hồi và Sắp tới vẫn đúng.
- F12-T2. Người thuộc 3 nhóm, có việc ở cả 3 → một danh sách hợp nhất, mỗi mục ghi rõ thuộc buổi/nhóm nào.
- F12-T3. Mục trong Sắp tới sắp theo giờ có mặt (`starts_at + report_offset_min`) và `due_at`; Task quá hạn nổi lên đầu.
- F12-T4. Người điều phối: Position thiếu người xuất hiện trong Cần xử lý; biến mất khi đủ `slots`.
- F12-T5. Người mới, chưa có gì → trạng thái rỗng có lối tới Lịch.

## F13. Lịch sử

| | |
| --- | --- |
| Đầu vào | Đối tượng người dùng xem được |
| Hành vi | Hiển thị dòng thời gian từ `activity_events` |
| Kết quả | Mỗi thay đổi có: ai, khi nào, gì, trước → sau |
| Lỗi | — |
| Quyền | `view` đối tượng; trường hạn chế bị che |

Kiểm thử:

- F13-T1. Với mỗi lệnh ghi trong `EVENT_API_CONTRACTS.md` §5–6 (trừ các ngoại lệ có chủ ý ở `DATA_MODEL.md` §6): sau khi chạy, có đúng các dòng `activity_events` như contract.
- F13-T2. Lệnh thất bại (lỗi quyền, xung đột) → không có dòng nào.
- F13-T3. Dời lịch → lịch sử Event hiện sự kiện gốc và các hệ quả lồng bên dưới.
- F13-T4. Trả lời hộ → lịch sử ghi cả người thực hiện và người được trả lời thay.
- F13-T5. Trả lời câu hỏi "ai đã đổi giờ, từ mấy giờ sang mấy giờ" chỉ bằng trang Event, không cần đọc chat.

## F14. Phân quyền và truy cập chéo

Kiểm thử (mỗi mục là một phép thử âm tính; kết quả mong đợi: `not_found` hoặc nội dung bị che):

- F14-T1. Mọi điểm cuối đọc: gọi bằng người không có quyền xem → `not_found`, thời gian phản hồi và thân lỗi không phân biệt được với đối tượng không tồn tại.
- F14-T2. Thành viên tổ chức A gọi đối tượng của tổ chức B → `not_found`.
- F14-T3. T1–T15 trong `PERMISSION_MODEL.md` §8: mỗi đường có một phép thử chứng minh bị chặn (T14 chỉ kiểm tín hiệu `access_changed` được gửi, AD-31).
- F14-T4. Tệp: địa chỉ tải hết hạn → không tải được; người không có `view(attachment)` xin địa chỉ → `not_found`.
- F14-T5. Event `visibility = groups`: hồ sơ của M1 xem bởi X không liệt kê Assignment của M1 trong Event đó.
- F14-T6. Nội dung thông báo đẩy không chứa nội dung tin nhắn hay lý do từ chối.

## Kịch bản đầu-cuối

| Mã | Kịch bản | Bao phủ |
| --- | --- | --- |
| E2E-1 | Dựng buổi Chúa nhật từ mẫu, xếp 8 người, publish; 6 nhận, 1 từ chối, 1 không trả lời; thay người từ chối; dời giờ 1 tiếng; mọi người xác nhận lại | F3–F7, F11, F12 |
| E2E-2 | Trong chat nhóm: tin nhắn → Task giao cho người ngoài nhóm → nhận → xong; kiểm tra người ngoài nhóm không đọc được chat | F8–F10, F14 |
| E2E-3 | Người mới nhận lời mời khi đã có yêu cầu chờ sẵn → trả lời trong lần mở đầu tiên | F1, F5, F12 |
| E2E-4 | Huỷ buổi đã có người nhận và Task đang làm | F7, F11, F13 |

## Điều kiện "xong" của MVP

1. Mọi phép thử `F*-T*` qua.
2. Bốn kịch bản đầu-cuối chạy được trên thiết bị thật, gồm thông báo đẩy (phụ thuộc OD-01).
3. Bất biến N1–N10 có phép thử tự động.
4. Không có lệnh ghi nào thiếu ActivityEvent (F13-T1).
