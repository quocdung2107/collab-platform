# PERMISSION_MODEL

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: `PRODUCT_MODEL.md`, `DATA_MODEL.md`

## 1. Nguyên tắc

1. **Mặc định từ chối.** Không có quy tắc cho phép thì không được phép.
2. **Một điểm quyết định.** Mọi kiểm tra đi qua `can(user, action, object)` của module Access, ở phía máy chủ. Client chỉ dùng kết quả để ẩn/hiện nút.
3. **Quyền suy ra từ quan hệ**, không cấp rời từng người. Không có bảng ACL tự do.
4. **Liên kết không mang quyền.** Link, mention, thẻ, thông báo, kết quả tìm kiếm đều không cấp quyền xem.
5. **Không lộ sự tồn tại.** Đối tượng không được phép xem trả về "không tìm thấy", không phải "bị cấm" (AD-12).
6. **Kiểm tra lại khi dùng.** Thông báo, đường dẫn đã lưu, bản đã tải về: quyền được kiểm tra tại thời điểm mở.
7. **Công việc minh bạch với quản trị, trò chuyện thì không.** Org admin xem được mọi Event và Task; không đọc được hội thoại của Group mà họ không phải thành viên (AD-11).

## 2. Vai trò

| Cấp | Vai trò | Nguồn |
| --- | --- | --- |
| Organization | `owner`, `admin`, `member` | `memberships.role` |
| Group | `leader`, `member` | `group_members.role` |
| Event | `event_owner` | `event_owners` |
| Position | `position_manager` = `event_owner` ∪ org admin ∪ `leader` của `positions.group_id` | suy ra |
| Assignment | `assignee` | `assignments.user_id` |
| Task | `task_owner`, `assigned_by`, `creator`, `collaborator` | `tasks`, `task_collaborators` |
| Task | `task_manager` = `assigned_by` ∪ `creator` ∪ người quản lý phạm vi (bảng §4.6) | suy ra |

"Org admin" dưới đây gồm cả `owner` và `admin`. Mọi vai trò đòi hỏi Membership `active`.

## 3. Vị từ xem

Đây là các định nghĩa duy nhất của "xem được". Mọi tài liệu khác tham chiếu tới đây.

| Vị từ | Đúng khi |
| --- | --- |
| `view(organization)` | Là thành viên `active` |
| `view(group)` | `view(organization)`. Thấy tên, mô tả, danh sách thành viên |
| `read(conversation)` anchor `group` | Là thành viên của Group đó |
| `view(event)` trạng thái `draft` | `event_owner`, org admin, hoặc `leader` của một Group trong `event_groups` |
| `view(event)` đã publish, `visibility = org` | `view(organization)` |
| `view(event)` đã publish, `visibility = groups` | `event_owner`; org admin; thành viên của một Group trong `event_groups`; hoặc có Assignment đang hiệu lực trên Event |
| `view(position)`, `view(assignment)` | `view(event)` của Event chứa nó. Assignment `draft` chỉ `position_manager` thấy |
| `view(assignment.decline_reason)` | `assignee` của nó, hoặc `position_manager` |
| `view(task)` `scope_type = event` | `view(event)` của Event đó |
| `view(task)` `scope_type = group` | Thành viên Group; hoặc `task_owner`, `collaborator`, `assigned_by`, `creator`; hoặc org admin |
| `view(task)` `scope_type = private` | `task_owner`, `collaborator`, `assigned_by`, `creator`; hoặc org admin |
| `read(conversation)` anchor `event` / `task` | `view` của anchor |
| `view(message)` | `read(conversation)` chứa nó |
| `view(attachment)` | `view` của đối tượng sở hữu (Message → `view(message)`; Event/Task → `view` tương ứng) |
| `view(user)` trong tổ chức | `view(organization)`. Thông tin liên hệ theo cài đặt hiển thị của người đó |

## 4. Ma trận quyền

Ký hiệu: ✔ được · ✖ không · điều kiện ghi trong ô.

### 4.1 Organization

| Hành động | `owner` | `admin` | `member` |
| --- | --- | --- | --- |
| Xem tổ chức, danh sách thành viên, danh sách nhóm | ✔ | ✔ | ✔ |
| Sửa thông tin, mặc định | ✔ | ✔ | ✖ |
| Tạo/thu hồi liên kết mời | ✔ | ✔ | ✖ |
| Gỡ thành viên, đổi vai trò `member ↔ admin` | ✔ | ✔ | ✖ |
| Cấp/gỡ `owner`, chuyển quyền sở hữu | ✔ | ✖ | ✖ |
| Xoá tổ chức | ✔ | ✖ | ✖ |
| Quản lý mẫu buổi | ✔ | ✔ | ✖ |
| Rời tổ chức | nếu còn `owner` khác | ✔ | ✔ |

### 4.2 Group

| Hành động | Org admin | `leader` | `member` | Không thuộc nhóm |
| --- | --- | --- | --- | --- |
| Xem tên, thành viên | ✔ | ✔ | ✔ | ✔ |
| Tạo nhóm | ✔ | — | — | ✖ (OD-05) |
| Sửa, lưu trữ nhóm | ✔ | ✔ | ✖ | ✖ |
| Thêm/gỡ thành viên, đổi vai trò | ✔ | ✔ | ✖ | ✖ |
| Rời nhóm | — | nếu còn `leader` khác | ✔ | — |

Org admin tự thêm mình vào nhóm được; hành động đó sinh `group.member_added` và hiển thị trong hội thoại nhóm.

### 4.3 Conversation và Message

| Hành động | Điều kiện |
| --- | --- |
| Đọc | `read(conversation)` |
| Gửi tin, trả lời, đính kèm | `read(conversation)` và anchor chưa bị huỷ/lưu trữ |
| Mention | Chỉ người có `read(conversation)` |
| Sửa tin | Người gửi; chỉ tin `kind = user` |
| Xoá tin | Người gửi; hoặc `leader` (hội thoại Group), `event_owner` (thread Event), `task_manager` (thread Task); org admin nếu đọc được hội thoại |
| Đặt chế độ thông báo cho mình | `read(conversation)` |

Tin `system` không ai sửa hay xoá được.

### 4.4 Event

| Hành động | Org admin | `event_owner` | `leader` nhóm trong `event_groups` | Người xem khác |
| --- | --- | --- | --- | --- |
| Xem | ✔ | ✔ | ✔ | theo `view(event)` |
| Tạo | ✔ | — | ✔ nếu Event gồm ít nhất một nhóm họ là `leader` | ✖ |
| Sửa, publish, dời lịch, đổi địa điểm, huỷ | ✔ | ✔ | ✖ | ✖ |
| Thêm/gỡ `event_owner`, đổi `event_groups`, đổi `visibility` | ✔ | ✔ | ✖ | ✖ |
| Thêm/sửa/gỡ Position | ✔ | ✔ | chỉ Position có `group_id` là nhóm của họ | ✖ |
| Theo dõi / tắt tiếng cho mình | ✔ | ✔ | ✔ | nếu `view(event)` |
| Xoá buổi (bản nháp xoá hẳn; còn lại ẩn mềm, AD-33) | ✔ | ✔ | ✖ | ✖ |

Người tạo Event tự động là `event_owner`. Event luôn có ít nhất một `event_owner`.

### 4.5 Assignment

| Hành động | `position_manager` | `assignee` | Người xem khác |
| --- | --- | --- | --- |
| Xem ai được xếp và trạng thái | ✔ | ✔ | nếu `view(event)` |
| Xem lý do từ chối | ✔ | của mình | ✖ |
| Tạo (xếp người) | ✔ | ✖ | ✖ |
| Nhận / Từ chối | ✔ trả lời hộ, có ghi `responded_by` | ✔ của mình | ✖ |
| Gỡ, thay người | ✔ | ✖ | ✖ |

Người được xếp phải là thành viên `active` của Organization; không cần thuộc Group nào.

### 4.6 Task

Người quản lý phạm vi:

| `scope_type` | Người quản lý phạm vi |
| --- | --- |
| `event` | `event_owner`, org admin, `leader` của nhóm trong `event_groups` |
| `group` | `leader` của Group, org admin |
| `private` | (không có) |

| Hành động | `task_manager` | `task_owner` | `collaborator` | Người xem khác |
| --- | --- | --- | --- | --- |
| Xem | ✔ | ✔ | ✔ | theo `view(task)` |
| Sửa tiêu đề, mô tả, hạn | ✔ | ✔ | ✖ | ✖ |
| Giao / giao lại | ✔ | ✖ (trả lại bằng Từ chối) | ✖ | ✖ |
| Nhận / Từ chối | ✖ | ✔ | ✖ | ✖ |
| Đổi `status` (bắt đầu, xong) | ✔ | ✔ | ✖ | ✖ |
| Mở lại, huỷ | ✔ | ✖ | ✖ | ✖ |
| Bật/tắt cờ `blocked`, `needs_help` | ✔ | ✔ | ✔ | ✖ |
| Thêm/gỡ `collaborator` | ✔ | ✔ | tự gỡ mình | ✖ |
| Theo dõi / tắt tiếng cho mình | ✔ | ✔ | ✔ | nếu `view(task)` |

Tạo Task:

| `scope_type` | Ai tạo được | Giao cho người khác |
| --- | --- | --- |
| `event` | Người quản lý phạm vi | Tự do |
| `group` | Mọi thành viên Group | Người quản lý phạm vi: tự do. Thành viên thường: `requires_acceptance` bị ép `true` (AD-16) |
| `private` | Mọi thành viên Organization | `requires_acceptance` bị ép `true` |

Người được giao phải có `view(task)` sau khi giao (với `private`/`group` họ có quyền đó nhờ chính vai trò `task_owner`).

### 4.7 Document (Attachment)

| Hành động | Điều kiện |
| --- | --- |
| Xem, tải | `view(attachment)` |
| Thêm vào Message | Quyền gửi tin trong Conversation |
| Thêm vào Event | Quyền sửa Event |
| Thêm vào Task | `task_manager`, `task_owner`, `collaborator` |
| Gỡ | Người tải lên, hoặc người có quyền sửa đối tượng sở hữu |

Tệp được phát qua địa chỉ có chữ ký, thời hạn ngắn, cấp sau khi kiểm tra `view(attachment)`. Không có địa chỉ công khai cố định.

### 4.8 Link, Subscription, Notification

| Đối tượng | Quy tắc |
| --- | --- |
| Link | Xem `CONTEXT_ENGINE.md` §5 |
| Subscription | Chỉ trên đối tượng người dùng xem được; người quản lý đối tượng có thể thêm người khác làm người theo dõi nếu người đó xem được đối tượng |
| Notification | Chỉ chủ sở hữu đọc được; không ai khác, kể cả org admin |

## 5. Người tham gia không thuộc Group

Tình huống: A là thành viên Organization, không thuộc nhóm Âm thanh, được xếp vào vị trí "Âm thanh" của một Event.

| Câu hỏi | Trả lời |
| --- | --- |
| A thấy Event? | Có. `visibility = org`: vốn đã thấy. `visibility = groups`: thấy nhờ Assignment đang hiệu lực |
| A thấy ai khác được xếp? | Có, tên và trạng thái. Không thấy lý do từ chối của người khác |
| A đọc thread của Event? | Có |
| A thấy Task của Event? | Có |
| A đọc hội thoại nhóm Âm thanh? | **Không** |
| A thấy tin nhắn nhóm đã sinh ra một Task giao cho A? | Không. Task hiện "Tin nhắn gốc không khả dụng". A chỉ thấy nội dung mà người tạo đã đưa vào tiêu đề/mô tả Task |
| A từ chối hoặc bị gỡ? | `visibility = groups`: A mất quyền xem Event ngay; Subscription trên Event bị xoá; thông báo cũ hiện "Nội dung không còn khả dụng" |
| A được giao Task `scope_type = group` của nhóm khác? | A thấy Task đó và thread của nó; không thấy hội thoại nhóm, không thấy Task khác của nhóm |

## 6. Truy cập chéo đối tượng

| # | Quy tắc |
| --- | --- |
| X1 | Hiển thị một Link đòi `view` cả hai đầu. Thiếu → thẻ "Nội dung bị giới hạn" không tiêu đề, không tác giả, không kiểu chi tiết |
| X2 | Thẻ đối tượng trong tin nhắn được dựng theo quyền của **người xem**, không phải người gửi |
| X3 | Dòng `system` về một Event chỉ được chiếu vào Conversation của Event và của các Group trong `event_groups`. Mọi người đọc được các Conversation đó đều có `view(event)` theo §3, nên không lộ |
| X4 | Dòng `system` về Task chỉ chiếu vào Conversation của chính Task. Trong Conversation chứa tin nhắn gốc chỉ có thẻ Task dưới tin nhắn đó, dựng theo quyền người xem (X2) |
| X5 | Thông báo không lưu bản chụp nội dung. Câu tóm tắt dựng khi xem, sau khi kiểm tra quyền (AD-10) |
| X6 | Nội dung thông báo đẩy dựng khi gửi, sau khi kiểm tra quyền; chỉ gồm tên đối tượng và loại thay đổi |
| X7 | Tìm kiếm lọc quyền trước xếp hạng; không trả số đếm mục ẩn |
| X8 | Lịch sử (`activity_events`) của đối tượng chỉ hiện với người có `view` đối tượng; trường nhạy cảm trong payload bị che theo quyền trường |
| X9 | Trả lời/trích dẫn tin nhắn chỉ trong cùng Conversation |
| X10 | Mention người không đọc được Conversation bị máy chủ từ chối |
| X11 | Hồ sơ thành viên chỉ liệt kê Assignment/Task nằm trong đối tượng người xem được phép thấy |

## 7. Thay đổi tư cách thành viên

| Sự kiện | Hệ quả |
| --- | --- |
| Rời/bị gỡ khỏi Group | Mất `read` hội thoại nhóm ngay. Task `scope_type = group` đang là owner: giữ quyền xem Task đó; người gỡ được hỏi có giao lại không. Assignment không bị ảnh hưởng |
| Rời/bị gỡ khỏi Organization | Membership → `removed`. Mọi Assignment đang hiệu lực ở Event tương lai → `cancelled` (`member_left`), báo `position_managers`. Task chưa xong đang là owner: `owner_id` về rỗng qua `task.assigned` (người cũ còn trong lịch sử), báo `assigned_by`. Gỡ khỏi mọi Group, `event_owners`, `task_collaborators`. Xoá Subscription, thiết bị nhận đẩy; huỷ delivery chưa gửi. Tin nhắn cũ giữ lại, hiển thị tên kèm "đã rời" |
| Là `event_owner` cuối cùng | Không cho rời/gỡ cho tới khi chỉ định người khác; với gỡ khỏi Organization, org admin thực hiện gỡ trở thành `event_owner` |
| Là `leader` cuối cùng của Group | Nhóm vẫn tồn tại; org admin được nhắc chỉ định |
| Xoá tài khoản người dùng | Ẩn danh hoá hồ sơ; giữ các dòng lịch sử với tên "Thành viên đã rời" |

## 8. Rủi ro đã xét và biện pháp

| # | Đường vượt quyền | Biện pháp |
| --- | --- | --- |
| T1 | Suy ra tiêu đề đối tượng bị hạn chế qua thẻ/Link | X1, X2 |
| T2 | Đọc nội dung qua thông báo cũ sau khi mất quyền | X5, nguyên tắc 6 |
| T3 | Đọc nội dung qua thông báo đẩy trên màn hình khoá | X6; delivery bị `skipped` nếu mất quyền trước khi gửi |
| T4 | Dò sự tồn tại bằng tìm kiếm hoặc số đếm | X7 |
| T5 | Dò sự tồn tại bằng đoán định danh | Định danh không tuần tự; nguyên tắc 5 |
| T6 | Chia sẻ địa chỉ tệp | Địa chỉ ký, thời hạn ngắn |
| T7 | Đọc hội thoại nhóm qua Task sinh từ tin nhắn | §5; `created_from` không cấp quyền |
| T8 | Dòng hệ thống trong chat nhóm lộ Event hạn chế | X3 |
| T9 | Org admin đọc chat nhóm | Nguyên tắc 7; tự thêm mình vào nhóm thì có dấu vết công khai |
| T10 | Lộ lý do từ chối/ngày bận | Quyền theo trường `view(assignment.decline_reason)`; X8 |
| T11 | Trả lời hộ để giả mạo đồng ý | `responded_by` được ghi, hiển thị "X xác nhận thay", người được xếp nhận thông báo |
| T12 | Thành viên thường ép việc cho người khác | AD-16: bắt buộc người nhận đồng ý |
| T13 | Liên kết mời bị lộ | Lưu dạng băm, có hạn, giới hạn số lần, thu hồi được |
| T14 | Dữ liệu còn trên thiết bị sau khi mất quyền | Client xoá bộ nhớ đệm khi nhận tín hiệu mất quyền. Giới hạn đã biết: không bảo đảm với thiết bị ngoại tuyến hoặc ảnh chụp màn hình |
| T15 | Mention để kéo người ngoài vào xem | X10 |

Không còn đường vượt quyền nào đã biết trong thiết kế ngoài giới hạn nêu ở T14. Tài liệu này chưa qua đánh giá bảo mật độc lập.

## 9. OPEN DECISION liên quan

OD-05 (nhóm ẩn, ai được tạo nhóm) · OD-06 (hiển thị mặc định của Event) · OD-07 (lưu trữ và nghĩa vụ pháp lý về dữ liệu cá nhân) · OD-11 (giới hạn thời gian sửa/xoá tin nhắn).

## Phụ lục: Thực thi ở Backend và RLS (AD-28)

1. Nguồn sự thật là `can(user, action, object)` trong Backend Node. Mọi lệnh ghi và mọi đọc có điều kiện quyền đi qua nó.
2. Backend xác thực JWT cục bộ bằng khoá công khai (JWKS) của nhà cung cấp, không gọi nhà cung cấp mỗi yêu cầu; kiểm tra `iss`, `exp`, `aud`. `[S]` đối chiếu `users.status = active` mỗi yêu cầu, vì JWT còn hiệu lực sau khi thành viên bị gỡ (T14 mở rộng: giới hạn thời gian sống của token).
3. RLS bật trên mọi bảng nghiệp vụ, mặc định từ chối. Chính sách chỉ là lớp thứ hai: chặn truy cập nếu thông tin đăng nhập của máy khách bị dùng trực tiếp với API cơ sở dữ liệu. Chính sách đơn giản (thành viên của `org_id`, thành viên của Group chủ), **không** sao chép toàn bộ ma trận X1–X11. Khi chính sách và `can()` khác nhau, `can()` quyết định; kiểm thử có một bộ ca đối chiếu hai bên.
4. Máy khách không ghi thẳng vào bảng nghiệp vụ. Kênh realtime riêng chỉ để nhận sự kiện (xem `EVENT_API_CONTRACTS.md` phụ lục).
5. Khoá dịch vụ (service key) chỉ nằm ở Backend, không bao giờ ở máy khách.
