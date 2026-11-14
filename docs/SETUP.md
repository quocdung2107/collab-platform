# Thiết lập Supabase và Google OAuth

Các bước này cần chủ dự án làm trên giao diện web; mã nguồn không tự làm được.

## 1. Dự án Supabase

1. Tạo tài khoản và tổ chức trên supabase.com, rồi tạo dự án mới. Vùng gợi ý: `ap-southeast-1` (Singapore), gần Việt Nam nhất.
2. Lưu mật khẩu cơ sở dữ liệu ở nơi an toàn.
3. **Bật khoá ký JWT bất đối xứng** (bắt buộc, API xác thực bằng JWKS): Project Settings → JWT Keys → chuyển sang khoá ký mới (ECC P-256 hoặc RSA) và xoay khoá. Kiểm tra: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` trả về ít nhất một khoá.
4. Lấy các giá trị:
   - `SUPABASE_URL` = `https://<ref>.supabase.co`
   - Khoá publishable (hoặc anon) cho `VITE_SUPABASE_PUBLISHABLE_KEY`
   - Chuỗi kết nối Postgres (Connect → Session pooler) cho `DATABASE_URL` của API
5. Chạy migration: `pnpm db:migrate -- --supabase`.

## 2. Google OAuth client

1. Google Cloud Console → APIs & Services → OAuth consent screen: loại External, điền tên ứng dụng, email hỗ trợ.
2. Credentials → Create credentials → OAuth client ID → Web application.
   - Authorized JavaScript origins: `http://localhost:5173` và tên miền web thật.
   - Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`
3. Supabase → Authentication → Sign In / Providers → Google: dán Client ID và Client Secret, bật.
4. Supabase → Authentication → URL Configuration: Site URL = địa chỉ web; thêm `http://localhost:5173` và `https://quocdung2107.github.io/collab-platform/` vào Redirect URLs.
5. Google OAuth client: thêm `https://quocdung2107.github.io` vào Authorized JavaScript origins.

## 3. Kiểm tra đầu-cuối

1. `pnpm dev:api` và `pnpm dev:web`, mở `http://localhost:5173`.
2. Bấm “Đăng nhập bằng Google” → sau khi quay lại thấy “Xin chào, <tên>”.
3. Trong cơ sở dữ liệu có một dòng mới ở `app.users` với `auth_subject` = id người dùng Supabase.

## 4. Bản web công khai cho thử nghiệm (OD-17, OD-18)

Bật repo → Settings → Pages → Source: **GitHub Actions**. Mỗi lần nhánh `main` thay đổi, workflow `pages.yml` triển khai web tới `https://quocdung2107.github.io/collab-platform/`.

## 5. Triển khai API lên Render (gói miễn phí)

Tệp `render.yaml` ở gốc repo mô tả dịch vụ `collab-api` (Node 22, vùng Singapore, kiểm tra sức khoẻ `/healthz`, tự triển khai khi `main` đổi).

1. Supabase → **Connect** → **Session pooler**: chép chuỗi kết nối (dạng `postgresql://postgres.<ref>:[PASSWORD]@<host>.pooler.supabase.com:5432/postgres`), thay `[PASSWORD]` bằng mật khẩu database, thêm `?sslmode=require&uselibpqcompat=true` vào cuối. Dùng Session pooler vì Render không ra được IPv6 của kết nối trực tiếp.
2. Render → **New → Blueprint** → chọn repo `collab-platform` → nhập `DATABASE_URL` ở bước trên → **Apply**.
3. Khi dịch vụ chạy, mở `https://<tên-dịch-vụ>.onrender.com/healthz` phải thấy `{"ok":true}`.
4. GitHub repo → Settings → Secrets and variables → Actions → **Variables** → thêm `API_URL` = URL Render ở trên (không có `/` cuối). Chạy lại workflow Pages (hoặc chờ lần đẩy kế tiếp lên `main`).

Đánh đổi đã biết:
- Gói miễn phí ngủ sau ~15 phút không có yêu cầu; yêu cầu đầu tiên sau đó chậm khoảng một phút. Chấp nhận được cho thử nghiệm, không cho vận hành thật.
- `uselibpqcompat=true&sslmode=require` mã hoá kết nối nhưng không xác minh chứng chỉ máy chủ (chứng chỉ Supabase ký bởi CA riêng). Trước khi chạy thật: tải CA từ Supabase (Database Settings → SSL) và dùng `sslmode=verify-full`.
- Migration không chạy tự động khi khởi động; áp bằng `pnpm db:migrate` hoặc qua connector Supabase rồi ghi sổ `app.schema_migrations`.
