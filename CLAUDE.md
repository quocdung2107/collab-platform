# Work-centered Communication Platform — ngữ cảnh dự án

Chủ sản phẩm: Dung. Ngôn ngữ làm việc: tiếng Việt. Mã nguồn: monorepo pnpm (xem README.md, docs/IMPLEMENTATION_NOTES.md); bộ đặc tả v0.2 trong `docs/spec/` là nguồn sự thật.

## Đọc theo thứ tự (trong `docs/spec/`)
1. ARCHITECTURE_DECISIONS.md (AD-01..30, OD, mức sẵn sàng)
2. PRODUCT_MODEL.md, rồi DATA_MODEL.md, PERMISSION_MODEL.md, NOTIFICATION_ENGINE.md, EVENT_API_CONTRACTS.md
3. UX_ARCHITECTURE.md, CONTEXT_ENGINE.md, MVP_ACCEPTANCE_CRITERIA.md, KOINONIA_INTEGRATION.md

## Nguyên tắc không được bỏ nếu không có lý do và so sánh phương án
Chat và Workspace ngang hàng; liên kết hai chiều; church-first với lõi độc lập miền; Assignment tách Task; Audience khác Subscription; ActivityEvent là nguồn lịch sử/sự kiện; Context Link truy xuất hai chiều; không AI trong MVP; Koinonia và Nền tảng tách biệt, tích hợp qua hợp đồng API.

## Ngăn xếp đã chốt
Responsive Web/PWA; Supabase Auth + Google OAuth; Supabase/PostgreSQL; React + TypeScript; Node.js + TypeScript Modular Monolith; Realtime, Storage, RLS. Logic và phân quyền ở Backend (`can()`), RLS là lớp thứ hai. PostgreSQL chuẩn, migration có kiểm soát. Koinonia (Electron/React/TS/Python/SQLite) chỉ nói chuyện qua API, không chung cơ sở dữ liệu.

## Việc đầu tiên khi bắt đầu xây dựng
Thử nghiệm OD-17 (push iPhone), OD-18 (đăng nhập Google trong trình duyệt nhúng Zalo/Messenger), OD-19 (realtime + gỡ thành viên). Bật khoá ký JWT bất đối xứng khi tạo dự án Supabase.

## Quy tắc làm việc
Đọc mã/tài liệu hiện có trước khi đề xuất thay đổi kiến trúc. Tách sự thật đã kiểm chứng, suy luận, giả thuyết. Không bịa API/tính năng. Điều chỉnh khi xây dựng thì cập nhật ngược tài liệu.
