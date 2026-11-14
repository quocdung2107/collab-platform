# Thử nghiệm OD-19: Realtime khi gỡ thành viên đang kết nối

Câu hỏi: dùng Broadcast trên kênh riêng (private channel) với RLS trên `realtime.messages` (OD-19 phương án b),
người bị gỡ khỏi nhóm khi đang kết nối có còn nhận sự kiện của nhóm không, và cơ chế nào chặn được?

## Cách chạy

- Migration: `db/supabase/0002_realtime_authz.sql` (hàm `rt.can_read_topic`, policy `rt_receive_broadcast`).
- `index.ts` chạy dưới dạng Supabase Edge Function `od19-spike` (Deno), để kết nối Realtime từ bên trong Supabase.
  Hàm tạo 3 người dùng thử (A, B trong nhóm; C ngoài nhóm), đăng ký kênh `group:{id}` và `user:{id}`,
  gửi sự kiện bằng `realtime.send()` từ cơ sở dữ liệu, gỡ B, rồi đo B còn nhận gì. Cuối cùng tự xoá dữ liệu thử.
- Gọi một lần bằng token trong `spike.runs`:

```sql
insert into spike.runs (token) values ('od19-' || gen_random_uuid()) returning token;
select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/od19-spike',
  body := jsonb_build_object('token', '<token>'),
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <anon key>'),
  timeout_milliseconds := 90000);
select content from net._http_response order by id desc limit 1;
```

## Kết quả

Xem `RESULTS.md`.
