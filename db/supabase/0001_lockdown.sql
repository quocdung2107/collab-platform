-- Đối tượng đặc thù Supabase (AD-29). Chỉ chạy trên dự án Supabase: `pnpm db:migrate -- --supabase`.
--
-- Schema `app` không nằm trong danh sách schema mà Data API (PostgREST) phơi ra, và các vai trò
-- phía máy khách (anon, authenticated) không có quyền nào trên nó. Máy khách chỉ dùng Supabase
-- cho Auth (và Realtime ở bước sau); mọi đọc/ghi nghiệp vụ đi qua Backend (AD-28).
--
-- Chính sách RLS cho realtime.messages sẽ được thêm sau thử nghiệm OD-19.

revoke all on schema app from anon, authenticated;
revoke all on all tables in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;
alter default privileges in schema app revoke all on tables from anon, authenticated;
alter default privileges in schema app revoke all on functions from anon, authenticated;
