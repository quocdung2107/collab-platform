# ARCHITECTURE_DECISIONS

Phiên bản 0.2 · 2026-11-13 (0.2: chủ sản phẩm chốt OD-01, OD-08, OD-13; thêm AD-25..AD-30, OD-17..OD-19)

Gồm bốn phần: quyết định đã chốt (AD), quyết định mở (OD), kết quả kiểm tra chéo, và đánh giá mức sẵn sàng.

## 1. Quyết định đã chốt

Mỗi mục: quyết định · lý do · phương án đã loại.

| Mã | Quyết định | Lý do | Phương án đã loại |
| --- | --- | --- | --- |
| AD-01 | Mọi Conversation có anchor (`group`/`event`/`task`). Hội thoại tự do (DM) là `[EXT]`, thêm bằng `anchor_type = direct` + bảng thành viên | Giữ Chat ngang hàng về mô hình và điều hướng mà không phải xây một ứng dụng nhắn tin tổng quát trước khi chứng minh giá trị lõi. Mở rộng sau không đổi mô hình | (a) Chat đầy đủ ngay: chi phí lớn nhất, khác biệt ít nhất. (b) Chat chỉ là bình luận của đối tượng: vi phạm nguyên tắc ngang hàng |
| AD-02 | `Assignment` (có mặt ở một vị trí trong một buổi) tách khỏi `Task` (việc có hạn) | Hai vòng đời khác nhau: Assignment gắn khung giờ Event và có xác nhận lại khi dời lịch; Task có tiến độ và hạn | Gộp thành một entity "Responsibility": máy trạng thái lai, khó hiểu với người dùng |
| AD-03 | Event thuộc Organization, liên quan N–N với Group | Một buổi cần nhiều nhóm; đặt trong một Group làm sai quyền và thông báo | Event thuộc một Group |
| AD-04 | Tham chiếu chéo module dùng cặp đa hình `(type, id)` với sổ đăng ký kiểu cố định; không FK vật lý | Messaging, Links, Activity, Notifications không phụ thuộc schema của Scheduling/Tasks; thêm kiểu đối tượng mới không sửa các module này | Cột FK riêng cho từng kiểu: toàn vẹn mạnh hơn nhưng mỗi kiểu mới phải sửa nhiều bảng. Rủi ro của phương án chọn được giảm bằng quy tắc không xoá cứng đối tượng công việc |
| AD-05 | "Người theo dõi" là `Subscription`, không phải vai trò trên Event/Task | Một cơ chế cho một khái niệm; đúng ranh giới Audience (cấu trúc) / Subscription (lựa chọn) | Vai trò `follower` trong bảng người tham gia (như báo cáo Discovery): trùng chức năng với Subscription |
| AD-06 | Hai lớp vật chất hoá (`action_required`, `direct`); lớp `ambient` không tạo bản ghi theo người | Tránh ghi N dòng cho N thành viên chung mỗi lần Event đổi; đúng yêu cầu "không gửi cùng một tin cho cả nhóm" | Ba lớp đều vật chất hoá: tốn ghi, và tạo áp lực "số chưa đọc" cho người không liên quan |
| AD-07 | "Bắt buộc" = có bản ghi + nằm trong My Workspace + người giao thấy trạng thái chờ. Không bao gồm "bắt buộc đẩy" | Không thể ép thông báo đẩy ở cấp hệ điều hành; trách nhiệm được bảo đảm bằng vòng phản hồi | Cấm tắt thông báo đẩy trong app: không thực thi được và gây phản cảm |
| AD-08 | `activity_events` là nhật ký duy nhất, ghi trong cùng giao dịch (outbox); `cause_id` luôn trỏ thẳng về sự kiện gốc | Một nguồn cho lịch sử, thông báo, dòng hệ thống, kiểm toán; `cause_id` phẳng cho phép gộp bằng một khoá | Event sourcing đầy đủ: phức tạp không cần thiết. Bảng lịch sử riêng theo entity: trùng lặp |
| AD-09 | Một bảng `links` cho mọi quan hệ ngữ cảnh. Mention lưu riêng ở `message_mentions`. `user` không là đầu của Link | Link trả lời "cái gì liên quan cái gì"; mention trả lời "báo cho ai". Gộp lại sẽ khiến một bảng mang hai nghĩa. Truy xuất theo thành viên dùng vai trò, không dùng Link | Cơ sở dữ liệu đồ thị; Link tới `user` |
| AD-10 | Notification không lưu bản chụp nội dung; câu tóm tắt và nội dung đẩy dựng khi xem/gửi sau khi kiểm tra quyền | Chặn rò rỉ qua thông báo cũ sau khi mất quyền | Lưu sẵn tiêu đề/nội dung: nhanh hơn nhưng rò rỉ |
| AD-11 | Org admin xem được mọi Event/Task nhưng không đọc được hội thoại Group nếu không là thành viên | Công việc chính thức cần minh bạch với quản trị; trò chuyện nhóm cần riêng tư. Tự thêm mình vào nhóm thì có dấu vết | Admin đọc mọi thứ; hoặc admin không thấy Task của nhóm |
| AD-12 | Đối tượng không được phép xem trả về `not_found` | Không lộ sự tồn tại | `forbidden` cho mọi trường hợp |
| AD-13 | Khoá lạc quan bằng `version`; lệnh chuyển trạng thái mang `expected_status`; lệnh ghi mang khoá idempotent | Xử lý nhiều người cùng sửa và mạng chập chờn mà không cần khoá phiên | Khoá bi quan theo phiên chỉnh sửa; "ghi sau thắng" |
| AD-14 | `declined` và `cancelled` là trạng thái cuối của Assignment; mời lại = dòng mới | Lịch sử rõ; không có vòng lặp trạng thái | Cho phép `declined → requested` trên cùng dòng |
| AD-15 | `position_manager` được trả lời hộ; luôn ghi `responded_by` và báo cho người được xếp | Thực tế có người xác nhận bằng lời hoặc qua kênh khác | Chỉ người được xếp tự trả lời: lưới phân công không bao giờ đầy đủ |
| AD-16 | Người không quản lý phạm vi mà giao việc cho người khác thì Task bắt buộc cần người nhận đồng ý | Cho phép Journey "tạo việc từ chat" với mọi thành viên mà không biến nó thành công cụ ép việc | Chỉ người quản lý được tạo Task (quá chặt); ai cũng giao tự do (lạm dụng) |
| AD-17 | Nhiều mốc giờ: MVP dùng `positions.report_offset_min`; tập dượt là Event riêng. Bảng `event_times` là `[EXT]` | Đủ cho trường hợp phổ biến với một cột | Bảng mốc giờ + bảng nối Position–mốc ngay từ đầu |
| AD-18 | Không có entity Decision. `[S]`: Link `relation = resolution` từ tin nhắn tới đối tượng | Phần lớn "quyết định" đã là trường dữ liệu có lịch sử; phần còn lại chỉ cần dấu ghim có nguồn | Entity Decision với quy trình phê duyệt |
| AD-19 | "Document" trong MVP là `Attachment`, quyền kế thừa từ đối tượng sở hữu | Không có nhu cầu quản lý tài liệu đã kiểm chứng | Module tài liệu riêng |
| AD-20 | Tích hợp Koinonia: phụ thuộc một chiều, Koinonia kéo `Plan` chỉ-đọc qua API trung tính | Không phụ thuộc vòng; mỗi ứng dụng dùng được một mình | Đồng bộ hai chiều; webhook; dùng chung cơ sở dữ liệu |
| AD-21 | Không có AI trong MVP và không dành chỗ trước trong schema | Theo nguyên tắc 8. Tập `origin` của Link mở rộng được khi có bằng chứng nhu cầu | Thêm sẵn `origin = ai`, `status = suggested` |
| AD-22 | Dời lịch → yêu cầu xác nhận lại thuộc MVP; bản xem trước chi tiết là `[S]` | Đây là hành vi kiểm chứng nguyên tắc "trách nhiệm không mất khi kế hoạch đổi" và là tình huống kiểm thử bắt buộc | Để toàn bộ sang Phase 3 (như báo cáo Discovery) |
| AD-23 | Mọi người tham gia phải là thành viên `active` của Organization. Khách ngoài tổ chức là `[EXT]` | Mô hình quyền đơn giản, một ranh giới tenant | Vai trò `guest` ngay từ đầu |
| AD-24 | My Workspace đọc trực tiếp từ bảng nghiệp vụ; `notifications` chỉ là hình chiếu | Thông báo trễ/lỗi không làm sai việc cần làm | My Workspace dựng từ hộp thông báo |
| AD-25 | **(Chốt OD-01)** Ứng dụng khách là Responsive Web / PWA, dùng được trên máy tính và điện thoại; không có ứng dụng gốc trong MVP | Chủ sản phẩm quyết định. Một mã nguồn, không qua cửa hàng ứng dụng, phù hợp nhà phát triển độc lập | Ứng dụng gốc trước; cả hai song song. Rủi ro đi kèm: xem OD-17, OD-18 |
| AD-26 | **(Chốt OD-08)** Đăng nhập bằng Supabase Auth + Google OAuth. Danh tính nội bộ tách khỏi nhà cung cấp: `users.auth_subject` là khoá ngoài-logic (không FK vật lý tới schema của nhà cung cấp). Thiết kế cho phép thêm số điện thoại + OTP sau; Zalo không thuộc MVP | Chủ sản phẩm quyết định. Tách `users` khỏi bảng của nhà cung cấp giữ được khả năng đổi nhà cung cấp và thêm phương thức đăng nhập mà không đổi mô hình | Tự viết xác thực; Zalo ngay từ đầu |
| AD-27 | **(Chốt OD-13)** Nền tảng backend: Supabase + PostgreSQL. Frontend React + TypeScript. API: Node.js + TypeScript theo Modular Monolith. Dùng Supabase Realtime, Storage, RLS | Chủ sản phẩm quyết định | Microservices (không cần ở quy mô này); tự vận hành hạ tầng |
| AD-28 | Logic nghiệp vụ và phân quyền quan trọng nằm ở Backend Node: một hàm `can(user, action, object)` là nguồn sự thật. RLS là lớp phòng thủ thứ hai (defense-in-depth), không phải nơi duy nhất thực thi quy tắc. Mọi lệnh ghi nghiệp vụ đi qua API; máy khách không ghi thẳng vào bảng nghiệp vụ | Theo nguyên tắc của chủ sản phẩm: không phụ thuộc hoàn toàn vào Supabase. Quy tắc phức tạp (X1–X11, ma trận quyền) khó và dễ sai khi chỉ viết bằng chính sách RLS | Chỉ dùng RLS + gọi trực tiếp từ máy khách: ít mã nhất nhưng đưa logic vào SQL, khó kiểm thử và khoá nhà cung cấp |
| AD-29 | PostgreSQL chuẩn; migration là tệp SQL có phiên bản trong kho mã, chạy có kiểm soát. Giao diện tới Realtime, Storage, Auth đặt sau các adapter của Backend. Đối tượng đặc thù Supabase (chính sách trên `realtime.messages`, `storage.objects`) được cô lập trong thư mục migration riêng và liệt kê | Theo nguyên tắc của chủ sản phẩm: tránh phụ thuộc sâu vào nhà cung cấp | Dùng bảng điều khiển để sửa schema; để mã nghiệp vụ gọi SDK nhà cung cấp rải rác |
| AD-30 | Koinonia giữ Electron + React + TypeScript + Python + SQLite. Hai ứng dụng giao tiếp qua API, **không dùng chung cơ sở dữ liệu**. Hệ quả: OD-09 nghiêng về (a) tách hẳn danh tính; Koinonia xác thực với Nền tảng bằng `access_grants` | Chủ sản phẩm quyết định phần công nghệ; kết luận về OD-09 là suy luận của đặc tả, chưa được chủ sản phẩm xác nhận riêng | Dùng chung cơ sở dữ liệu (đã loại ở AD-20) |

Thay đổi so với nguyên tắc đầu vào: **không có**. Chín nguyên tắc ở `PRODUCT_MODEL.md` §1 được giữ nguyên.

## 2. OPEN DECISION

"Chặn" = phải chốt trước khi bắt đầu triển khai phần được nêu.

| Mã | Câu hỏi | Phương án | Đề xuất | Chặn |
| --- | --- | --- | --- | --- |
| OD-01 | ~~Nền tảng client~~ **ĐÃ CHỐT → AD-25** (Responsive Web / PWA trước) | — | — | Không còn. Rủi ro còn lại chuyển sang OD-17 |
| OD-02 | Ngưỡng dời lịch buộc xác nhận lại | (a) mọi thay đổi (b) đổi ngày hoặc ≥ 30 phút (c) do người điều phối chọn từng lần | (b), cấu hình theo tổ chức | Không (có mặc định) |
| OD-03 | Giờ yên lặng mặc định và ngoại lệ vượt giờ yên lặng | (a) tắt mặc định (b) 22:00–06:30 bật, không ngoại lệ (c) như (b) + ngoại lệ khi buổi sắp diễn ra | (c) | Không (có mặc định) |
| OD-04 | Kênh Zalo cho thông báo | Chưa kiểm chứng chi phí, điều kiện, chính sách | Nghiên cứu riêng; thiết kế kênh đã cho phép thêm | Không |
| OD-05 | Nhóm ẩn; ai được tạo nhóm | (a) chỉ org admin tạo, mọi nhóm đều hiện tên (b) thành viên tạo được (c) có nhóm ẩn | (a) cho MVP | Không (có mặc định) |
| OD-06 | Hiển thị mặc định của Event | `org` hoặc `groups` | `org`, cấu hình theo tổ chức | Không (có mặc định) |
| OD-07 | Thời hạn lưu giữ và nghĩa vụ pháp lý về dữ liệu cá nhân (đặc biệt với tổ chức tôn giáo) | Chưa kiểm chứng quy định hiện hành | Cần tư vấn pháp lý trước khi mở cho tổ chức thật | **Trước khi ra mắt**, không chặn xây dựng |
| OD-08 | ~~Phương thức đăng nhập~~ **ĐÃ CHỐT → AD-26** (Google OAuth trước) | — | — | Không còn. Rủi ro còn lại chuyển sang OD-18 |
| OD-09 | Danh tính dùng chung với Koinonia | (a) tách hẳn (b) chung nhà cung cấp danh tính | (a), suy ra từ AD-30; chờ chủ sản phẩm xác nhận | Chỉ chặn `[EXT]` |
| OD-10 | Thư viện bài hát | (a) hoàn toàn trong Koinonia (b) danh mục dùng chung | (a) cho tới khi có nhu cầu chọn bài ngay trên Nền tảng | Chỉ chặn `[EXT]` |
| OD-11 | Giới hạn thời gian sửa/xoá tin nhắn | (a) không giới hạn, có nhãn "đã sửa" (b) giới hạn theo thời gian | (a) | Không (có mặc định) |
| OD-12 | Phase 0 (kiểm chứng nhu cầu) chưa chạy | — | Đặc tả này sẵn sàng về kỹ thuật không có nghĩa là nhu cầu đã được xác nhận | Rủi ro sản phẩm, do chủ sản phẩm quyết |
| OD-13 | ~~Ngăn xếp công nghệ~~ **ĐÃ CHỐT → AD-27, AD-28, AD-29** | — | — | Không còn. Chi tiết phát sinh: OD-19 |
| OD-14 | Ánh xạ `Plan` vào cấu trúc Koinonia | Cần đọc mã nguồn Koinonia | — | Chỉ chặn `[EXT]` |
| OD-15 | Cho phép xếp vượt `slots`? | (a) từ chối (b) cho phép kèm cảnh báo | (a) | Không (có mặc định) |
| OD-16 | Thành viên mới của nhóm có thấy lịch sử hội thoại không | (a) thấy (b) chỉ từ lúc vào (c) trưởng nhóm chọn | (a) cho MVP; (c) về sau | Không (có mặc định) |
| OD-17 | Độ tin cậy thông báo đẩy của PWA, nhất là iPhone: Web Push chỉ hoạt động khi người dùng đã thêm ứng dụng vào Màn hình chính. Tỷ lệ cài đặt thực tế của thành viên và hiệu lực của `action_required` khi chưa cài là chưa biết | (a) chấp nhận, hướng dẫn cài trong ứng dụng (b) thêm kênh phụ (email) cho `action_required` (c) bọc PWA thành ứng dụng gốc sau này | (a)+(b) cho MVP; đo tỷ lệ cài ở pilot. AD-07 vẫn đúng vì thông báo đẩy không phải điều kiện của "bắt buộc" | **F11** (chấp nhận), không chặn xây dựng |
| OD-18 | Đăng nhập Google khi liên kết mở trong trình duyệt nhúng (ví dụ liên kết chia sẻ trong ứng dụng nhắn tin) có thể bị Google chặn. Chưa kiểm chứng với Zalo | (a) phát hiện trình duyệt nhúng và hướng dẫn "mở bằng trình duyệt" (b) thêm đăng nhập email/OTP sớm | (a) cho MVP; kiểm thử trên Zalo/Messenger thật. Nếu thất bại thường xuyên thì nâng (b) | **F1** (chấp nhận), không chặn xây dựng |
| OD-19 | Cơ chế đẩy thời gian thực tới máy khách: Postgres Changes hay Broadcast từ cơ sở dữ liệu trên kênh riêng; xử lý token hết hạn cho kênh | (a) Postgres Changes (b) Broadcast + kênh riêng, phân quyền bằng RLS trên `realtime.messages` | (b), đề xuất chưa thử nghiệm. Cần một thử nghiệm kỹ thuật với quyền thành viên Group thay đổi khi đang kết nối | **F6, F11** |

## 3. Kiểm tra chéo

Đã thực hiện hai lớp: (1) đối chiếu tự động tên verb, tên bảng, mã AD/OD giữa 10 tệp; (2) rà soát thủ công sáu tiêu chí dưới đây. Đây là tự kiểm tra của người viết, **chưa phải đánh giá độc lập**.

### 3.1 Không có entity trùng chức năng

| Cặp nghi vấn | Kết luận |
| --- | --- |
| Vai trò `follower` ↔ `subscriptions` | Đã bỏ vai trò `follower` (AD-05) |
| `message_mentions` ↔ Link tới `user` | Chỉ giữ `message_mentions` (AD-09) |
| `tasks.source_message_id` ↔ Link `created_from` | Chỉ giữ Link; trường này chỉ là tham số đầu vào của lệnh |
| Chế độ thông báo của hội thoại ↔ `subscriptions` | Gộp vào `subscriptions` (`target_type = conversation`); `conversation_states` chỉ giữ vị trí đọc |
| Bảng lịch sử theo entity ↔ `activity_events` | Chỉ có `activity_events` (AD-08) |
| Trạng thái hành động của Notification ↔ trạng thái nghiệp vụ | Notification là hình chiếu; nguồn sự thật là bảng nghiệp vụ (AD-24) |
| Decision ↔ trường dữ liệu + lịch sử | Không có entity Decision (AD-18) |
| Document ↔ Attachment | Chỉ Attachment (AD-19) |

### 3.2 Không có quan hệ dữ liệu mâu thuẫn

| Điểm rà | Kết luận |
| --- | --- |
| Task thuộc Event và Group cùng lúc | Bị chặn bằng CHECK theo `scope_type` |
| Assignment trỏ `event_id` khác Event của Position | `event_id` là bản sao; bất biến `assignments.event_id = positions.event_id` ghi ở `DATA_MODEL.md` §7 |
| Conversation có hai anchor | UNIQUE `(anchor_type, anchor_id)`; một cặp anchor duy nhất trên dòng |
| `cause_id` nhiều tầng | Quy ước luôn trỏ về gốc |
| Xoá cứng bản nháp Event ↔ `activity_events` append-only | Ngoại lệ có chủ ý: bản nháp chưa từng publish được xoá cùng sự kiện của riêng nó; ghi ở `DATA_MODEL.md` §3.6 và §5 |

### 3.3 Không có luồng thông báo thiếu người nhận

| Điểm rà | Kết luận |
| --- | --- |
| Mọi verb đều có dòng trong ma trận hoặc nằm trong danh sách "không thông báo" | Đã đối chiếu tự động |
| Lỗi phát hiện khi rà: người đang `requested` nhận bản ghi thứ hai khi dời lịch | Đã sửa bằng quy tắc "làm mới bản ghi đang chờ" (`NOTIFICATION_ENGINE.md` §8.2) |
| Lỗi phát hiện khi rà: Task `in_progress` được giữ khi huỷ Event nhưng owner không được báo | Đã sửa: `event.cancelled` báo owner của mọi Task chưa xong thuộc Event |
| Lỗi phát hiện khi rà: owner Task rời tổ chức, không ai được báo | Đã sửa: `task.assigned` với `to_owner_id` rỗng → `assigned_by` (dự phòng: người quản lý phạm vi) |
| Lỗi phát hiện khi rà: một nguyên nhân gốc tạo nhiều mục cần hành động (gỡ thành viên có nhiều Assignment) | Đã sửa: bảng `notification_items`; bản ghi `done` khi mọi mục cần hành động đã giải quyết |
| Từ chối khi Position không có nhóm phụ trách | `position_managers` vẫn gồm `event_owners`; Event luôn có ≥ 1 owner |
| `assigned_by` không còn là thành viên | Dự phòng sang người quản lý phạm vi; với Task `private` không có người quản lý phạm vi → Task ở trạng thái "cần phân công lại" mà không ai được báo. **Giới hạn đã biết**, chấp nhận cho MVP vì Task `private` của người đã rời không còn chủ thể liên quan |

### 3.4 Không có đường truy cập vượt quyền

Rà theo 15 đường trong `PERMISSION_MODEL.md` §8. Tất cả có biện pháp trong thiết kế. Giới hạn còn lại: dữ liệu đã nằm trên thiết bị ngoại tuyến (T14).

Một điểm cần chú ý khi triển khai: quy tắc X3 dựa trên việc dòng hệ thống của Event **chỉ** chiếu vào hội thoại của Group trong `event_groups`. Nếu sau này cho phép chiếu vào hội thoại khác, phải rà lại.

### 3.5 Không có hành động quan trọng thiếu lịch sử

| Điểm rà | Kết luận |
| --- | --- |
| Mọi lệnh ghi trong `EVENT_API_CONTRACTS.md` §5–6 phát ≥ 1 verb | Đúng, trừ các ngoại lệ có chủ ý |
| Ngoại lệ có chủ ý | Trạng thái đã đọc, Subscription, Preference, đăng ký thiết bị, xoá bản nháp chưa publish, ghi `external_refs` |
| Hành động thay mặt | `responded_by`, `actor_id`, `removed_by`, `deleted_by` đều được ghi |
| Thay đổi do hệ thống | `actor_type = system` + `cause_id` |

### 3.6 Không có tính năng MVP phụ thuộc tính năng chưa triển khai

| Tính năng MVP | Có dùng `[S]`/`[EXT]`? | Kết luận |
| --- | --- | --- |
| Dời lịch + xác nhận lại | Xem trước chi tiết là `[S]` | MVP dùng màn hình xác nhận với số đếm từ `summary` của chính lệnh dời lịch; không cần API xem trước |
| Thông báo | Nhắc việc, leo thang, tóm tắt, `scheduled_jobs` là `[S]` | Giờ yên lặng và thử lại dùng `notification_deliveries.not_before`, không cần `scheduled_jobs` |
| My Workspace | Khối "Có gì mới" | Đọc `notifications` lớp `direct`; không cần tóm tắt `ambient` |
| Bảng xếp lịch | Cảnh báo ngày bận là `[S]` | Cảnh báo trùng giờ dùng `assignments`, có sẵn |
| Tạo Event | Dòng chương trình là `[S]` | Mẫu MVP chỉ gồm Position và Task |
| Tìm | Tìm toàn văn là `[S]` | MVP lọc theo tên bằng cột `*_norm` |
| Từ chối | Đề xuất người thay là `[S]` | Người điều phối tự chọn người thay |

## 4. Mức sẵn sàng

| Điều kiện | Đánh giá |
| --- | --- |
| Product Model nhất quán | Đạt (theo tự kiểm tra §3.1–3.2) |
| UX chuyển được thành prototype | Đạt: 10 màn hình có đặc tả, 6 luồng prototype được liệt kê. Chưa có bản vẽ |
| Data Model đủ chi tiết để triển khai | Đạt ở mức logic; ngăn xếp đã chốt (PostgreSQL). Kiểu vật lý và chỉ mục chi tiết do bước triển khai quyết định, theo phụ lục cuối `DATA_MODEL.md` |
| Permission Model không có lỗ hổng thiết kế đã biết | Đạt, với một giới hạn đã nêu (T14). Chưa qua đánh giá độc lập |
| Notification có quy tắc xác định | Đạt. Các tham số thời gian là giá trị khởi đầu, chưa có dữ liệu thực nghiệm |
| API và Event Contracts được định nghĩa | Đạt ở mức logic: danh mục verb đầy đủ, 8 lệnh chính có contract chi tiết, các lệnh còn lại được liệt kê |
| MVP có Acceptance Criteria kiểm thử được | Đạt: 14 chức năng, 4 kịch bản đầu-cuối, 10 bất biến |
| Quyết định mở được liệt kê | Đạt: 19 mục (3 đã chốt, 3 mới) |

**Kết luận: READY FOR IMPLEMENTATION.**

Ba quyết định chặn (OD-01, OD-08, OD-13) đã chốt. Ngày 2026-11-14 chủ sản phẩm đã tự xem `PERMISSION_MODEL.md` và `NOTIFICATION_ENGINE.md`, đánh giá là triển khai được và sẽ điều chỉnh theo thực tế trong quá trình xây dựng; vòng đánh giá độc lập được miễn theo quyết định này. Rủi ro còn lại: hai tài liệu chưa qua người đánh giá không tham gia viết, nên các lỗi thiết kế sẽ lộ ra ở giai đoạn kiểm thử. Mọi điều chỉnh khi xây dựng phải cập nhật ngược vào tài liệu và ghi AD mới nếu đổi nguyên tắc.

Đồng ý theo đề xuất cho các mục còn lại (OD-02..07, 09..11, 15..19 theo cột "Đề xuất").

Không chặn xây dựng nhưng phải xử lý trong giai đoạn đầu: OD-17 (push iPhone), OD-18 (đăng nhập trong trình duyệt nhúng), OD-19 (cơ chế realtime) bằng các thử nghiệm kỹ thuật nhỏ; OD-07 trước khi ra mắt.

**OD-12** vẫn đứng nguyên: sẵn sàng về đặc tả không thay thế cho việc kiểm chứng nhu cầu ở Phase 0. Đó là quyết định của chủ sản phẩm.
