# UX_ARCHITECTURE

Phiên bản 0.1 · 2026-11-13 · Phụ thuộc: `PRODUCT_MODEL.md`, `PERMISSION_MODEL.md`, `NOTIFICATION_ENGINE.md`

## 1. Hai kiểu người dùng

| | Thành viên | Người điều phối |
| --- | --- | --- |
| Là ai | Người được xếp lịch, được giao việc | Org admin, trưởng nhóm, người phụ trách Event |
| Việc chính | Xem việc của mình, trả lời, đọc/nhắn | Dựng buổi, xếp người, theo dõi phản hồi, đổi kế hoạch |
| Giới hạn thiết kế | Mọi việc thường ngày ≤ 2 lần chạm; không phải học khái niệm nào | Được dùng màn hình dày hơn; ưu tiên tốc độ nhập |

Thành viên không bao giờ nhìn thấy các từ: Context, Subscription, Audience, Workspace, Entity, Link.

| Khái niệm nội bộ | Nhãn giao diện |
| --- | --- |
| My Workspace | Việc của tôi |
| Event / Schedule | Buổi / Lịch |
| Position, Assignment | Vị trí, Phân công |
| Subscription `follow` / `mute` | Theo dõi / Tắt tiếng |
| Context (Link) | Liên quan |
| Notification `action_required` / `direct` | Cần bạn / Nên biết |

## 2. Information Architecture

```
Thanh dưới (4 tab, ngang hàng)
 ├─ Việc của tôi      → My Workspace
 ├─ Lịch              → Schedule → Event → (Position, Task, Thread)
 ├─ Chat              → Danh sách Conversation → Conversation
 └─ Nhóm              → Danh sách Group → Group → Member Profile

Thanh trên (mọi tab)
 ├─ Chuông            → Notification Inbox
 ├─ Kính lúp          → Search
 └─ Ảnh đại diện      → Hồ sơ của tôi · Cài đặt thông báo · Đổi tổ chức · Organization Settings (admin)
```

Quy tắc điều hướng:

1. Mọi đối tượng có một địa chỉ (deep link) duy nhất; mở từ chat, thông báo, tìm kiếm hay My Workspace đều tới cùng một màn hình.
2. Chuyển Chat ↔ Workspace không mất chỗ: nút quay lại trả về đúng vị trí cuộn và tin nhắn xuất phát.
3. Mở tin nhắn gốc từ một đối tượng → mở Conversation, cuộn tới và làm nổi tin nhắn đó.
4. Không có quyền xem đích → màn hình "Nội dung bị giới hạn", không lộ tiêu đề.
5. Tab Chat hiển thị cả hội thoại Group lẫn thread của Event/Task mà người dùng đọc được và đã từng có hoạt động liên quan tới họ; thread có nhãn kiểu anchor.

## 3. Thành phần dùng chung

| Thành phần | Mô tả |
| --- | --- |
| Thẻ đối tượng | Khối trong tin nhắn/danh sách: biểu tượng kiểu, tiêu đề, một dòng trạng thái, tối đa 2 nút hành động theo quyền người xem. Không quyền xem → thẻ xám "Nội dung bị giới hạn" |
| Dòng hệ thống | Tin `system` trong Conversation: chữ nhỏ, căn giữa, không ảnh đại diện; chạm để mở đối tượng |
| Khối "Liên quan" | Trên Event/Task: tin nhắn gốc, tin nhắn nhắc tới, đối tượng liên kết, tệp. Mục không có quyền bị ẩn, chỉ hiện số đếm "n mục bạn không có quyền xem" |
| Khối "Lịch sử" | Dòng thời gian từ ActivityEvent: ai, làm gì, từ gì sang gì |
| Chip trạng thái | Assignment: Chờ · Đã nhận · Từ chối · Cần xác nhận lại · Đã huỷ. Task: Chưa làm · Đang làm · Xong · Đã huỷ, kèm Quá hạn / Bị chặn / Cần giúp |
| Trạng thái chung | Đang tải (khung xương) · Rỗng (kèm một hành động gợi ý) · Lỗi (thử lại) · Ngoại tuyến (đọc bản đã lưu; hành động xếp hàng chờ, hiện nhãn "chờ gửi") |

## 4. Đặc tả màn hình

### 4.1 My Workspace `[MVP]`

- **Mục tiêu:** trả lời "tôi cần làm gì, khi nào, có gì đổi" trong một màn hình.
- **Thành phần:** ba khối theo thứ tự cố định: (1) Cần phản hồi, (2) Sắp tới, (3) Có gì mới. Người điều phối có thêm khối (0) Cần xử lý ở trên cùng.
- **Hành động chính:** Nhận / Từ chối trên từng mục; chạm để mở đối tượng; đánh dấu Xong cho Task.
- **Dữ liệu:**
  - Cần phản hồi: Assignment của tôi ở `requested`/`reconfirm`; Task của tôi có `acceptance = pending`.
  - Sắp tới: Assignment `accepted` và Task `open`/`in_progress` của tôi, trộn theo thời gian (giờ có mặt hoặc hạn), 14 ngày tới; Task không hạn nằm cuối.
  - Có gì mới: Notification lớp `direct` chưa đọc, mới nhất trước, tối đa 10.
  - Cần xử lý (điều phối): Position còn thiếu người trong Event tôi quản lý; Task tôi giao bị từ chối.
- **Trạng thái:** rỗng toàn bộ ("Bạn chưa có việc nào. Xem lịch sắp tới") · rỗng từng khối (ẩn khối) · có mục quá hạn (nổi lên đầu Sắp tới).
- **Ngoại lệ:** mục vừa bị huỷ bởi người khác trong lúc đang xem → biến mất kèm thông báo ngắn; trả lời khi ngoại tuyến → xếp hàng, nếu khi gửi mà trạng thái đã đổi thì hiện trạng thái mới và huỷ thao tác.

### 4.2 Chat `[MVP]`

- **Mục tiêu:** đọc và nhắn trong nhóm hoặc trong thread của một buổi/việc.
- **Thành phần:** (a) danh sách Conversation: tên, nhãn kiểu anchor, tin cuối, số chưa đọc, biểu tượng tắt tiếng; (b) màn hình hội thoại: tiêu đề + nút mở anchor, dòng tin nhắn, dòng hệ thống, ô soạn tin với nút đính kèm, `@`, và chèn thẻ đối tượng.
- **Hành động chính:** gửi tin; trả lời; nhấn giữ tin nhắn → Tạo việc · Trả lời · Sao chép · Sửa/Xoá (của mình) · `[S]` Đánh dấu đã chốt.
- **Dữ liệu:** Message theo `seq`; người gửi; thẻ đối tượng; tệp; trạng thái đã đọc của chính mình (vạch "tin mới").
- **Trạng thái:** rỗng · đang gửi · gửi lỗi (thử lại) · chỉ-đọc (anchor đã huỷ hoặc mất quyền ghi) · tin đã xoá ("Tin nhắn đã bị xoá").
- **Ngoại lệ:** mention người không đọc được hội thoại → không cho chọn; chèn thẻ đối tượng mà một số thành viên không xem được → cảnh báo một dòng, vẫn cho gửi (họ thấy thẻ giới hạn); mất quyền khi đang mở → đóng hội thoại, về danh sách.

"Tạo việc" từ tin nhắn: mở bảng nhỏ với tiêu đề điền sẵn từ nội dung, trường bắt buộc duy nhất là người phụ trách (mặc định: chưa giao), hạn là tùy chọn. Sau khi tạo, thẻ Task hiện ngay dưới tin nhắn gốc.

### 4.3 Group `[MVP]`

- **Mục tiêu:** biết nhóm gồm ai và nhóm đang có gì.
- **Thành phần:** đầu trang (tên, số thành viên, nút vào Chat); danh sách Event sắp tới có liên quan tới nhóm; Task phạm vi nhóm đang mở; danh sách thành viên; với trưởng nhóm: nút Thêm/Xoá thành viên, Đổi vai trò.
- **Hành động chính:** vào Chat của nhóm; mở Event/Task; (trưởng nhóm) quản lý thành viên.
- **Dữ liệu:** Group, GroupMember, Event qua EventGroup, Task `scope_type = group`.
- **Trạng thái:** người xem là thành viên · người xem không phải thành viên (chỉ thấy tên, thành viên, Event công khai; không có nút Chat) · nhóm đã lưu trữ (chỉ-đọc).
- **Ngoại lệ:** xoá thành viên đang có Task nhóm chưa xong → hỏi xử lý (giữ / chuyển người khác); nhóm không còn trưởng nhóm → org admin được nhắc chỉ định.

### 4.4 Event `[MVP]`

- **Mục tiêu:** một trang cho mọi thứ về một buổi; là nơi "hiện tại ai phụ trách gì" được trả lời.
- **Thành phần:** đầu trang (tên, thời gian, địa điểm, trạng thái, người phụ trách, nút Theo dõi/Tắt tiếng); các phần: Phân công (Position → người + chip trạng thái), Việc (Task của Event), Thảo luận (xem trước thread + nút mở), Liên quan, Lịch sử. Thành viên được xếp thấy băng "Vị trí của bạn" ở trên cùng với nút Nhận/Từ chối.
- **Hành động chính:** thành viên: Nhận / Từ chối, mở thread. Điều phối: Sửa, Xếp người, Thêm việc, Dời lịch, Huỷ buổi, Sao chép buổi.
- **Dữ liệu:** Event, EventOwner, Position, Assignment, Task, tin mới nhất của Conversation, Link, ActivityEvent.
- **Trạng thái:** `draft` (băng "Bản nháp, chưa gửi cho ai") · `published` · `cancelled` (băng đỏ, mọi nút hành động tắt) · đã diễn ra (chỉ-đọc trừ thread và Task).
- **Ngoại lệ:** hai người sửa cùng lúc → người lưu sau nhận thông báo "đã có thay đổi", xem bản mới rồi áp lại; Event bị huỷ khi đang mở → băng đỏ xuất hiện; lý do từ chối chỉ người quản lý vị trí thấy.

Dời lịch `[MVP]`: nhập giờ mới → màn hình xác nhận liệt kê số người sẽ được báo và số người phải xác nhận lại → Xác nhận. `[S]` bản xem trước chi tiết tên từng người và từng Task bị ảnh hưởng.

### 4.5 Schedule `[MVP]`

- **Mục tiêu:** thành viên xem lịch tổ chức; người điều phối dựng buổi và thấy chỗ còn trống.
- **Thành phần:** danh sách Event theo thời gian (mặc định) và chế độ tháng; bộ lọc: Tất cả / Của tôi / theo Nhóm; mỗi dòng: tên, giờ, vị trí của tôi (nếu có), chỉ báo đủ/thiếu người (điều phối). Nút Tạo buổi (điều phối): Từ mẫu · Sao chép buổi trước · Buổi trống.
- **Bảng xếp lịch** (điều phối, trong Event): lưới Position × ô người; chọn người từ danh sách thành viên nhóm phụ trách trước, sau đó toàn tổ chức; cảnh báo: trùng giờ với Assignment đang hiệu lực khác, ngày bận (AD-34; chỉ hiện khi xếp, không có lý do).
- **Hành động chính:** mở Event; tạo Event; xếp người; Gửi yêu cầu (publish).
- **Dữ liệu:** Event người xem được phép thấy; Assignment của người xem; đếm Assignment theo trạng thái cho từng Position.
- **Trạng thái:** rỗng · chỉ có bản nháp · quá khứ (cuộn lên).
- **Ngoại lệ:** xếp người vào Position đã đủ `slots` → từ chối kèm gợi ý tăng số người cần; xếp một người vào hai vị trí cùng buổi → cho phép sau cảnh báo; mẫu tham chiếu nhóm đã lưu trữ → bỏ qua phần đó và báo.

#### 4.5b Lập lịch nhiều cấp (AD-32)

- **Mục tiêu:** người điều phối thấy tổng quan năm → quý → tháng → tuần và phát hiện chỗ thiếu người, bản nháp chưa gửi, tuần trống.
- **Lối vào:** nút "Lập lịch" trên tab Lịch, chỉ hiện cho org admin và trưởng nhóm. Thành viên không thấy chế độ này.
- **Thành phần:** thanh chọn mức Năm · Quý · Tháng · Tuần; đường dẫn ngữ cảnh có lùi/tới; cây tổng quan (L2) với số chỗ cần chú ý trên mỗi nút; bảng Nhịp & Giai đoạn (L3) để ẩn/hiện từng nhịp. Máy tính ≥ 1024px: ba cột; điện thoại: L2 và L3 là bảng trượt.
- **Mức Năm:** 12 tháng, mỗi tháng có số buổi, nháp, thiếu người. **Mức Quý:** ma trận tuần × nhịp (điện thoại: hàng = tuần; máy tính: hàng = nhịp). **Mức Tháng:** lưới tháng có chấm theo nhịp + danh sách theo tuần. **Mức Tuần:** dải 7 ngày + từng buổi với số vị trí đã lấp.
- **Mã hoá trạng thái:** đã qua (xám) · đủ người (xanh) · thiếu (cam) · nháp (viền) · đã huỷ (gạch) · tuần trống giữa các buổi của cùng nhịp (viền cam đứt) · dự kiến (viền đứt xám, ghi ngày) · bỏ qua (gạch ngang) · cần quyết (nền cam, "!").
- **Giai đoạn:** chip màu trên mỗi ô tháng (Năm), trên ma trận (Quý) và lưới tháng; ngày đặc biệt có ★ ở cột tuần và tô màu ô ngày.
- **Hành động:** chạm buổi đã tạo mở trang Buổi; chạm buổi dự kiến/cần quyết mở bảng: Tạo bản nháp buổi này · Giữ cả hai · Bỏ buổi này · Đổi giờ buổi này · Sửa cả nhịp. Thanh hành động: "Tạo n bản nháp" cho khoảng đang xem (bỏ qua chỗ cần quyết), "Lặp tuần này…" (mức Tuần), "Lặp tháng này…" (mức Tháng), "+ Thêm" (nhịp từ mẫu, giai đoạn). Bảng Nhịp: Sửa nhịp với phạm vi Cả nhịp / Từ ngày, nút "Xem ảnh hưởng" bắt buộc trước khi lưu (số buổi dự kiến, bản nháp, buổi đã gửi và số người sẽ được báo dời lịch, buổi đã sửa riêng giữ nguyên); danh sách ngoại lệ; ngoại lệ theo giai đoạn; Ngừng nhịp.

### 4.6 Task `[MVP]`

- **Mục tiêu:** biết việc là gì, ai chịu trách nhiệm, đến đâu rồi.
- **Thành phần:** tiêu đề, mô tả, người phụ trách, người giao, người phối hợp, hạn, chip trạng thái và cờ, thuộc Event/Group nào, tệp, Thảo luận, Liên quan (gồm tin nhắn gốc), Lịch sử.
- **Hành động chính:** người phụ trách: Nhận / Từ chối (nếu được yêu cầu), Bắt đầu, Xong, bật cờ Bị chặn / Cần giúp. Người giao/quản lý: Sửa, Giao lại, Huỷ, Mở lại.
- **Dữ liệu:** Task, TaskCollaborator, Attachment, Link, ActivityEvent.
- **Trạng thái:** chưa giao · chờ nhận · đang hiệu lực · quá hạn · xong · đã huỷ · "cần phân công lại" (`acceptance = declined`).
- **Ngoại lệ:** tin nhắn gốc đã xoá hoặc người xem không đọc được → "Tin nhắn gốc không khả dụng"; Event cha bị huỷ → băng thông báo, Task đang làm vẫn giữ; giao lại khi người cũ đang bấm Xong → thao tác đến sau bị từ chối kèm trạng thái mới.

### 4.7 Member Profile `[MVP]`

- **Mục tiêu:** biết một người là ai trong tổ chức và liên hệ thế nào.
- **Thành phần:** ảnh, tên, vai trò tổ chức, các nhóm; liên hệ (theo cài đặt hiển thị của người đó); "Sắp phục vụ": Assignment sắp tới trong các Event mà người xem được phép thấy. `[S]` cho người điều phối: lịch sử phục vụ, ngày bận.
- **Hành động chính:** `[EXT]` nhắn riêng. MVP: gọi/nhắn qua liên hệ ngoài nếu được hiển thị.
- **Dữ liệu:** User, Membership, GroupMember, Assignment (đã lọc quyền).
- **Trạng thái:** hồ sơ của chính mình (thêm nút Sửa, Cài đặt hiển thị liên hệ) · thành viên đã rời ("Thành viên đã rời tổ chức", không có liên hệ).
- **Ngoại lệ:** không hiển thị lý do từ chối, lý do bận, hay số liệu "tỉ lệ từ chối" cho bất kỳ ai ở MVP.

### 4.8 Notification Inbox `[MVP]`

- **Mục tiêu:** một nơi cho mọi điều hệ thống đã báo cho tôi; không bỏ sót điều cần hành động.
- **Thành phần:** hai tab: Cần bạn (lớp `action_required`, còn `pending`) và Tất cả; mỗi mục: biểu tượng, câu tóm tắt dựng tại thời điểm xem, thời gian, nút hành động tại chỗ nếu có; nút Đánh dấu tất cả đã đọc (chỉ áp dụng cho lớp `direct`).
- **Hành động chính:** hành động tại chỗ (Nhận/Từ chối/Xem); chạm để mở đối tượng; đánh dấu đã đọc.
- **Dữ liệu:** Notification của người dùng; đối tượng đích (kiểm tra quyền khi dựng).
- **Trạng thái:** chưa đọc · đã đọc · cần hành động · đã xử lý · đã được thay thế ("Đã có cập nhật mới hơn") · rỗng.
- **Ngoại lệ:** đối tượng đích không còn quyền xem → mục hiện "Nội dung không còn khả dụng"; mục `action_required` không biến mất khi chỉ đọc, chỉ khi hành động được thực hiện hoặc bị thay thế; mục gộp (một thay đổi, nhiều hệ quả) mở ra danh sách con.

### 4.9 Search `[S]`

- **Mục tiêu:** tìm một buổi, việc, người, nhóm hoặc tin nhắn bằng vài từ, gõ không dấu cũng được.
- **Thành phần:** ô tìm; bộ lọc kiểu (Buổi, Việc, Tin nhắn, Người, Nhóm); kết quả nhóm theo kiểu, mỗi mục có đoạn trích và ngữ cảnh (thuộc buổi/nhóm nào).
- **Hành động chính:** mở kết quả; với tin nhắn → nhảy tới tin đó trong Conversation.
- **Dữ liệu:** chỉ đối tượng người tìm được phép xem; lọc quyền trước khi xếp hạng.
- **Trạng thái:** chưa nhập (hiện tìm kiếm gần đây) · đang tìm · không có kết quả · lỗi.
- **Ngoại lệ:** không bao giờ hiện số đếm kết quả bị ẩn; tin đã xoá không xuất hiện.

MVP không có màn hình Search; thay bằng lọc theo tên trong Lịch và danh sách Nhóm.

### 4.10 Organization Settings `[MVP]`

- **Mục tiêu:** quản trị tổ chức. Chỉ `owner`/`admin` thấy.
- **Thành phần:** Thông tin tổ chức (tên, múi giờ); Thành viên (danh sách, vai trò, mời qua liên kết, gỡ); Nhóm (tạo, lưu trữ, chỉ định trưởng nhóm); Mẫu buổi (tạo, sửa, lưu trữ); Mặc định (hiển thị Event, ngưỡng xác nhận lại).
- **Hành động chính:** tạo liên kết mời; đổi vai trò; gỡ thành viên; quản lý mẫu.
- **Dữ liệu:** Organization, Membership, Invite, Group, EventTemplate.
- **Trạng thái:** liên kết mời còn hạn / hết hạn / đã thu hồi.
- **Ngoại lệ:** gỡ thành viên có Assignment sắp tới → hiện danh sách vị trí sẽ trống trước khi xác nhận; không thể gỡ hoặc hạ vai trò `owner` cuối cùng; chuyển quyền `owner` cần xác nhận hai bước.

## 5. Cài đặt thông báo (trong menu cá nhân) `[MVP]`

- Ba công tắc: Thông báo đẩy cho "Cần bạn" · Thông báo đẩy cho "Nên biết" · Giờ yên lặng (từ – đến).
- Dòng giải thích cố định: "Việc cần bạn luôn nằm trong Việc của tôi, kể cả khi tắt thông báo đẩy."
- Theo từng hội thoại: Tất cả tin · Chỉ khi nhắc tên · Tắt tiếng. Theo từng Event/Task: Theo dõi · Tắt tiếng.
- `[S]` Bản tóm tắt: Tắt · Hằng ngày · Hằng tuần.

## 6. Luồng cần dựng prototype

| # | Luồng | Màn hình đi qua |
| --- | --- | --- |
| P1 | Nhận lời mời → thấy yêu cầu chờ → Nhận | Liên kết mời → My Workspace |
| P2 | Dựng buổi từ mẫu → xếp người → gửi | Schedule → Event (nháp) → Bảng xếp lịch → Event |
| P3 | Từ chối kèm lý do → người điều phối thay người | Thông báo đẩy → Event → My Workspace (điều phối) → Bảng xếp lịch |
| P4 | Dời lịch → xác nhận lại | Event → xác nhận dời → Inbox (thành viên) → Event |
| P5 | Tạo việc từ tin nhắn → nhận → xong | Chat → bảng Tạo việc → My Workspace → Task |
| P6 | Tra cứu "ai phụ trách" và tin nhắn gốc | Schedule → Event → Liên quan → Chat |

## 7. Giới hạn thao tác cho thành viên

Thành viên chỉ cần biết 5 hành động: Nhận, Từ chối, Xong, Nhắn tin, Tắt tiếng. Mọi hành động khác (tạo buổi, xếp người, dời lịch, giao lại, quản lý nhóm) chỉ xuất hiện khi người dùng có quyền tương ứng.

## Phụ lục: Bố cục đáp ứng (AD-25)

- Điện thoại: thanh 4 tab ở đáy, màn hình đơn cột, điều hướng ngăn xếp.
- Máy tính: thanh bên trái thay cho thanh tab; Chat và Event/Task có thể mở cạnh nhau (hai cột) vì liên kết hai chiều là cốt lõi.
- Mọi hành động của thành viên (5 hành động) dùng được bằng một tay trên điện thoại; mục tiêu chạm tối thiểu 44 px.
- Màn hình đăng nhập phát hiện trình duyệt nhúng và hiển thị hướng dẫn "Mở bằng trình duyệt" (OD-18).
- Lời nhắc cài vào Màn hình chính hiển thị sau lần đăng nhập đầu, không chặn việc dùng (OD-17).
